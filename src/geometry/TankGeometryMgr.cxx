/* bzflag
 * Copyright (c) 1993-2025 Tim Riker
 *
 * This package is free software;  you can redistribute it and/or
 * modify it under the terms of the license found in the file
 * named COPYING that should have accompanied this file.
 *
 * THIS PACKAGE IS PROVIDED ``AS IS'' AND WITHOUT ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, WITHOUT LIMITATION, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
 */

// bzflag common headers
#include "common.h"
#include "global.h"

// interface header
#include "TankGeometryMgr.h"

// system headers
#include <stdlib.h>
#include <math.h>
#include <string>
#include <string.h>

// common implementation headers
#include "SceneRenderer.h"
#include "StateDatabase.h"
#include "BZDBCache.h"
#include "OpenGLGState.h"
#ifdef __EMSCRIPTEN__
#include <vector>
#include "OpenGLVertexBuffer.h"
#endif


// use the namespaces
using namespace TankGeometryMgr;
using namespace TankGeometryEnums;
using namespace TankGeometryUtils;


// Local Variables
// ---------------

// the display lists
static GLuint displayLists[LastTankShadow][LastTankLOD]
[LastTankSize][LastTankPart];

// triangle counts
static int partTriangles[LastTankShadow][LastTankLOD]
[LastTankSize][LastTankPart];

// the scaling factors
static GLfloat scaleFactors[LastTankSize][3] =
{
    {1.0f, 1.0f, 1.0f},   // Normal
    {1.0f, 1.0f, 1.0f},   // Obese
    {1.0f, 1.0f, 1.0f},   // Tiny
    {1.0f, 0.001f, 1.0f}, // Narrow
    {1.0f, 1.0f, 1.0f}    // Thief
};
// the current scaling factors
static const float* currentScaleFactor = scaleFactors[Normal];

// the current shadow mode (used to remove glNormal3f and glTexcoord2f calls)
static TankShadow shadowMode = ShadowOn;

#ifdef __EMSCRIPTEN__
// No display lists under WebGL: each part is recorded once into a vertex
// buffer as a triangle list. Shadows draw the same buffer without normals
// and texcoords, so there is no shadow dimension.
static OpenGLVertexBuffer partBuffers[LastTankLOD][LastTankSize][LastTankPart];
static bool buffersBuilt = false;

// recording state
static std::vector<GLfloat>* recordTarget = NULL; // triangles of the part
static std::vector<GLfloat> recordPrim;           // current primitive
static GLenum recordMode = GL_TRIANGLES;
static GLfloat recordNormal[3] = {0.0f, 0.0f, 1.0f};
static GLfloat recordTexcoord[2] = {0.0f, 0.0f};
#endif

// arrays of functions to avoid large switch statements
typedef int (*partFunction)(void);
static const partFunction partFunctions[LastTankLOD][BasicTankParts] =
{
    {
        buildLowBody,
        buildLowBarrel,
        buildLowTurret,
        buildLowLCasing,
        buildLowRCasing
    },
    {
        buildMedBody,
        NULL,
        buildMedTurret,
        buildMedLCasing,
        buildMedRCasing
    },
    {
        buildHighBody,
        buildHighBarrel,
        buildHighTurret,
        buildHighLCasing,
        buildHighRCasing
    }
};


// Local Function Prototypes
// -------------------------

static void setupScales();
static void freeContext(void *data);
static void initContext(void *data);
static void bzdbCallback(const std::string& str, void *data);


/****************************************************************************/

// TankGeometryMgr Functions
// -------------------------


void TankGeometryMgr::init()
{
    // initialize the lists to invalid
    for (int shadow = 0; shadow < LastTankShadow; shadow++)
    {
        for (int lod = 0; lod < LastTankLOD; lod++)
        {
            for (int size = 0; size < LastTankSize; size++)
            {
                for (int part = 0; part < LastTankPart; part++)
                {
                    displayLists[shadow][lod][size][part] = INVALID_GL_LIST_ID;
                    partTriangles[shadow][lod][size][part] = 0;
                }
            }
        }
    }

    // install the BZDB callbacks
    // This MUST be done after BZDB has been initialized in main()
    BZDB.addCallback (StateDatabase::BZDB_OBESEFACTOR, bzdbCallback, NULL);
    BZDB.addCallback (StateDatabase::BZDB_TINYFACTOR, bzdbCallback, NULL);
    BZDB.addCallback (StateDatabase::BZDB_THIEFTINYFACTOR, bzdbCallback, NULL);
    BZDB.addCallback ("animatedTreads", bzdbCallback, NULL);

    // install the context initializer
    OpenGLGState::registerContextInitializer (freeContext, initContext, NULL);

    // setup the scaleFactors
    setupScales();

    return;
}


void TankGeometryMgr::kill()
{
    // remove the BZDB callbacks
    BZDB.removeCallback (StateDatabase::BZDB_OBESEFACTOR, bzdbCallback, NULL);
    BZDB.removeCallback (StateDatabase::BZDB_TINYFACTOR, bzdbCallback, NULL);
    BZDB.removeCallback (StateDatabase::BZDB_THIEFTINYFACTOR, bzdbCallback, NULL);
    BZDB.removeCallback ("animatedTreads", bzdbCallback, NULL);

    // remove the context initializer callback
    OpenGLGState::unregisterContextInitializer(freeContext, initContext, NULL);

    return;
}


void TankGeometryMgr::deleteLists()
{
#ifdef __EMSCRIPTEN__
    for (int lod = 0; lod < LastTankLOD; lod++)
        for (int size = 0; size < LastTankSize; size++)
            for (int part = 0; part < LastTankPart; part++)
                partBuffers[lod][size][part].clear();
    buffersBuilt = false;
#endif
    // delete the lists that have been aquired
    for (int shadow = 0; shadow < LastTankShadow; shadow++)
    {
        for (int lod = 0; lod < LastTankLOD; lod++)
        {
            for (int size = 0; size < LastTankSize; size++)
            {
                for (int part = 0; part < LastTankPart; part++)
                {
                    GLuint& list = displayLists[shadow][lod][size][part];
                    if (list != INVALID_GL_LIST_ID)
                    {
                        glDeleteLists(list, 1);
                        list = INVALID_GL_LIST_ID;
                    }
                }
            }
        }
    }
    return;
}


void TankGeometryMgr::buildLists()
{
    // setup the tread style
    setTreadStyle(BZDB.evalInt("treadStyle"));

    // setup the scale factors
    setupScales();
    currentScaleFactor = scaleFactors[Normal];

    const bool animated = BZDBCache::animatedTreads;

    // setup the quality level
    const int divisionLevels[4][2] =   // wheel divs, tread divs
    {
        {4, 4},   // low
        {8, 16},  // med
        {12, 24}, // high
        {16, 32}  // experimental
    };
    int quality = RENDERER.useQuality();
    if (quality < 0)
        quality = 0;
    else if (quality > 3)
        quality = 3;
    int wheelDivs = divisionLevels[quality][0];
    int treadDivs = divisionLevels[quality][1];

    for (int shadow = 0; shadow < LastTankShadow; shadow++)
    {
#ifdef __EMSCRIPTEN__
        // shadows reuse the ShadowOff buffers
        if (shadow != ShadowOff)
        {
            memcpy(partTriangles[shadow], partTriangles[ShadowOff],
                   sizeof(partTriangles[shadow]));
            continue;
        }
#endif
        for (int lod = 0; lod < LastTankLOD; lod++)
        {
            for (int size = 0; size < LastTankSize; size++)
            {

                // only do the basics, unless we're making an animated tank
                int lastPart = BasicTankParts;
                if (animated)
                    lastPart = HighTankParts;

                // set the shadow mode for the doNormal3f() and doTexcoord2f() calls
                shadowMode = (TankShadow) shadow;

                for (int part = 0; part < lastPart; part++)
                {

                    if ((part == Barrel) && (lod == MedTankLOD))
                        continue;
                    GLuint& list = displayLists[shadow][lod][size][part];
                    int& count = partTriangles[shadow][lod][size][part];

#ifdef __EMSCRIPTEN__
                    (void)list;
                    std::vector<GLfloat> triangles;
                    recordTarget = &triangles;
#else
                    // get a new OpenGL display list
                    list = glGenLists(1);
                    glNewList(list, GL_COMPILE);
#endif

                    // setup the scale factor
                    currentScaleFactor = scaleFactors[size];

                    if ((part <= Turret) || (!animated))
                    {
                        // the basic parts
                        count = partFunctions[lod][part]();
                    }
                    else
                    {
                        // the animated parts
                        if (part == LeftCasing)
                            count = buildHighLCasingAnim();
                        else if (part == RightCasing)
                            count = buildHighRCasingAnim();
                        else if (part == LeftTread)
                            count = buildHighLTread(treadDivs);
                        else if (part == RightTread)
                            count = buildHighRTread(treadDivs);
                        else if ((part >= LeftWheel0) && (part <= LeftWheel3))
                        {
                            int wheel = part - LeftWheel0;
                            count = buildHighLWheel(wheel, (float)wheel * (float)(M_PI / 2.0),
                                                    wheelDivs);
                        }
                        else if ((part >= RightWheel0) && (part <= RightWheel3))
                        {
                            int wheel = part - RightWheel0;
                            count = buildHighRWheel(wheel, (float)wheel * (float)(M_PI / 2.0),
                                                    wheelDivs);
                        }
                    }

#ifdef __EMSCRIPTEN__
                    recordTarget = NULL;
                    partBuffers[lod][size][part].setInterleaved(triangles);
#else
                    // end of the list
                    glEndList();
#endif

                } // part
            } // size
        } // lod
    } // shadow

#ifdef __EMSCRIPTEN__
    buffersBuilt = true;
#endif

    return;
}


GLuint TankGeometryMgr::getPartList(TankGeometryEnums::TankShadow shadow,
                                    TankGeometryEnums::TankPart part,
                                    TankGeometryEnums::TankSize size,
                                    TankGeometryEnums::TankLOD lod)
{
    if ((part == Barrel) && (lod == MedTankLOD))
        lod = LowTankLOD;

    return displayLists[shadow][lod][size][part];
}


int TankGeometryMgr::getPartTriangleCount(TankGeometryEnums::TankShadow sh,
        TankGeometryEnums::TankPart part,
        TankGeometryEnums::TankSize size,
        TankGeometryEnums::TankLOD lod)
{
    if ((part == Barrel) && (lod == MedTankLOD))
        lod = LowTankLOD;

    return partTriangles[sh][lod][size][part];
}


#ifdef __EMSCRIPTEN__
void TankGeometryMgr::renderPart(TankShadow shadow,
                                 TankPart part,
                                 TankSize size,
                                 TankLOD lod)
{
    if ((part == Barrel) && (lod == MedTankLOD))
        lod = LowTankLOD;

    if (!buffersBuilt)
        buildLists();

    OpenGLVertexBuffer& buffer = partBuffers[lod][size][part];
    if (buffer.getCount() == 0)
        return;

    const bool full = (shadow == ShadowOff);
    buffer.bind(full, full);
    glDrawArrays(GL_TRIANGLES, 0, buffer.getCount());
    OpenGLVertexBuffer::unbind();
}
#endif // __EMSCRIPTEN__


const float* TankGeometryMgr::getScaleFactor(TankSize size)
{
    return scaleFactors[size];
}


/****************************************************************************/

// Local Functions
// ---------------


static void bzdbCallback(const std::string& UNUSED(name), void * UNUSED(data))
{
    deleteLists();
    buildLists();
    return;
}


static void freeContext(void * UNUSED(data))
{
    // delete all of the lists
    deleteLists();
    return;
}


static void initContext(void * UNUSED(data))
{
    buildLists();
    return;
}


static void setupScales()
{
    float scale;

    scaleFactors[Normal][0] = BZDBCache::tankLength;
    scale = (float)atof(BZDB.getDefault(StateDatabase::BZDB_TANKLENGTH).c_str());
    scaleFactors[Normal][0] /= scale;

    scaleFactors[Normal][1] = BZDBCache::tankWidth;
    scale = (float)atof(BZDB.getDefault(StateDatabase::BZDB_TANKWIDTH).c_str());
    scaleFactors[Normal][1] /= scale;

    scaleFactors[Normal][2] = BZDBCache::tankHeight;
    scale = (float)atof(BZDB.getDefault(StateDatabase::BZDB_TANKHEIGHT).c_str());
    scaleFactors[Normal][2] /= scale;

    scale = BZDB.eval(StateDatabase::BZDB_OBESEFACTOR);
    scaleFactors[Obese][0] = scale * scaleFactors[Normal][0];
    scaleFactors[Obese][1] = scale * scaleFactors[Normal][1];
    scaleFactors[Obese][2] = scaleFactors[Normal][2];

    scale = BZDB.eval(StateDatabase::BZDB_TINYFACTOR);
    scaleFactors[Tiny][0] = scale * scaleFactors[Normal][0];
    scaleFactors[Tiny][1] = scale * scaleFactors[Normal][1];
    scaleFactors[Tiny][2] = scaleFactors[Normal][2];

    scale = BZDB.eval(StateDatabase::BZDB_THIEFTINYFACTOR);
    scaleFactors[Thief][0] = scale * scaleFactors[Normal][0];
    scaleFactors[Thief][1] = scale * scaleFactors[Normal][1];
    scaleFactors[Thief][2] = scaleFactors[Normal][2];

    scaleFactors[Narrow][0] = scaleFactors[Normal][0];
    scaleFactors[Narrow][1] = 0.001f;
    scaleFactors[Narrow][2] = scaleFactors[Normal][2];

    return;
}


/****************************************************************************/

// TankGeometryUtils Functions
// ---------------------------


#ifdef __EMSCRIPTEN__
void TankGeometryUtils::doBegin(GLenum mode)
{
    recordMode = mode;
    recordPrim.clear();
}


// append vertex i of the current primitive to the part's triangle list
static void emitVertex(size_t i)
{
    const GLfloat* v = &recordPrim[i * OpenGLVertexBuffer::FloatsPerVertex];
    recordTarget->insert(recordTarget->end(), v,
                         v + OpenGLVertexBuffer::FloatsPerVertex);
}


void TankGeometryUtils::doEnd()
{
    if (recordTarget == NULL)
        return;
    const size_t n = recordPrim.size() / OpenGLVertexBuffer::FloatsPerVertex;
    for (size_t i = 0; i + 2 < n; )
    {
        switch (recordMode)
        {
        case GL_TRIANGLES:
            emitVertex(i);
            emitVertex(i + 1);
            emitVertex(i + 2);
            i += 3;
            break;
        case GL_TRIANGLE_STRIP:
            // keep the winding consistent on odd triangles
            emitVertex((i & 1) ? i + 1 : i);
            emitVertex((i & 1) ? i : i + 1);
            emitVertex(i + 2);
            i++;
            break;
        case GL_TRIANGLE_FAN:
            emitVertex(0);
            emitVertex(i + 1);
            emitVertex(i + 2);
            i++;
            break;
        default:
            i = n;
            break;
        }
    }
    recordPrim.clear();
}


void TankGeometryUtils::doVertex3f(GLfloat x, GLfloat y, GLfloat z)
{
    if (recordTarget == NULL)
        return;
    const float* scale = currentScaleFactor;
    const GLfloat v[OpenGLVertexBuffer::FloatsPerVertex] =
    {
        x * scale[0], y * scale[1], z * scale[2],
        recordNormal[0], recordNormal[1], recordNormal[2],
        recordTexcoord[0], recordTexcoord[1]
    };
    recordPrim.insert(recordPrim.end(), v, v + OpenGLVertexBuffer::FloatsPerVertex);
}


void TankGeometryUtils::doNormal3f(GLfloat x, GLfloat y, GLfloat z)
{
    const float* scale = currentScaleFactor;
    GLfloat sx = x * scale[0];
    GLfloat sy = y * scale[1];
    GLfloat sz = z * scale[2];
    const GLfloat d = sqrtf ((sx * sx) + (sy * sy) + (sz * sz));
    if (d > 1.0e-5f)
    {
        x *= scale[0] / d;
        y *= scale[1] / d;
        z *= scale[2] / d;
    }
    recordNormal[0] = x;
    recordNormal[1] = y;
    recordNormal[2] = z;
}


void TankGeometryUtils::doTexCoord2f(GLfloat x, GLfloat y)
{
    recordTexcoord[0] = x;
    recordTexcoord[1] = y;
}

#else // __EMSCRIPTEN__

void TankGeometryUtils::doBegin(GLenum mode)
{
    glBegin(mode);
}


void TankGeometryUtils::doEnd()
{
    glEnd();
}


void TankGeometryUtils::doVertex3f(GLfloat x, GLfloat y, GLfloat z)
{
    const float* scale = currentScaleFactor;
    x = x * scale[0];
    y = y * scale[1];
    z = z * scale[2];
    glVertex3f(x, y, z);
    return;
}


void TankGeometryUtils::doNormal3f(GLfloat x, GLfloat y, GLfloat z)
{
    if (shadowMode == ShadowOn)
        return;
    const float* scale = currentScaleFactor;
    GLfloat sx = x * scale[0];
    GLfloat sy = y * scale[1];
    GLfloat sz = z * scale[2];
    const GLfloat d = sqrtf ((sx * sx) + (sy * sy) + (sz * sz));
    if (d > 1.0e-5f)
    {
        x *= scale[0] / d;
        y *= scale[1] / d;
        z *= scale[2] / d;
    }
    glNormal3f(x, y, z);
    return;
}


void TankGeometryUtils::doTexCoord2f(GLfloat x, GLfloat y)
{
    if (shadowMode == ShadowOn)
        return;
    glTexCoord2f(x, y);
    return;
}

#endif // __EMSCRIPTEN__


// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
