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

// implementation header
#include "MeshDrawMgr.h"

// common headers
#include "bzfgl.h"
#include "OpenGLGState.h"
#include "MeshDrawInfo.h"
#include "bzfio.h" // for DEBUGx()

#ifdef __EMSCRIPTEN__
#include <algorithm>
#endif


MeshDrawMgr::MeshDrawMgr(const MeshDrawInfo* drawInfo_)
    : drawInfo(drawInfo_)
{
    if ((drawInfo == nullptr) || !drawInfo->isValid())
    {
        printf("MeshDrawMgr: invalid drawInfo\n");
        fflush(stdout);
        return;
    }
    else
    {
        logDebugMessage(4,"MeshDrawMgr: initializing\n");
        fflush(stdout);
    }

    auto lodCount = drawInfo->getLodCount();
    lodLists.resize(lodCount);

    // This pointer is a convience way to iterate over the DrawLod objects known to the MeshDrawInfo. A first-class
    // iterator would be better
    auto curDrawLod = drawInfo->getDrawLods();

    // size each LodList to the corresponding DrawLod
    for (auto &item : lodLists)
        item.assign((curDrawLod++)->count, INVALID_GL_LIST_ID);

    makeLists();
    OpenGLGState::registerContextInitializer(freeContext, initContext, this);
}


MeshDrawMgr::~MeshDrawMgr()
{
    logDebugMessage(4,"MeshDrawMgr: killing\n");

    OpenGLGState::unregisterContextInitializer(freeContext, initContext, this);
    freeLists();

    return;
}


inline void MeshDrawMgr::rawExecuteCommands(int lod, int set)
{
    auto drawLods = drawInfo->getDrawLods();
    const DrawLod& drawLod = drawLods[lod];
    const DrawSet& drawSet = drawLod.sets[set];
    const int cmdCount = drawSet.count;
    for (int i = 0; i < cmdCount; i++)
    {
        const DrawCmd& cmd = drawSet.cmds[i];
        glDrawElements(cmd.drawMode, cmd.count, cmd.indexType, cmd.indices);
    }
    return;
}


#ifdef __EMSCRIPTEN__
static unsigned int getIndex(const DrawCmd& cmd, int i)
{
    if (cmd.indexType == DrawCmd::DrawIndexUShort)
        return ((const GLushort*)cmd.indices)[i];
    return ((const GLuint*)cmd.indices)[i];
}


// convert one draw command to 16-bit indices, turning every polygon mode
// into GL_TRIANGLES
static void convertCmd(const DrawCmd& cmd, std::vector<GLushort>& tris,
                       std::vector<GLushort>& other)
{
    const int n = cmd.count;
    auto tri = [&](int a, int b, int c)
    {
        tris.push_back((GLushort)getIndex(cmd, a));
        tris.push_back((GLushort)getIndex(cmd, b));
        tris.push_back((GLushort)getIndex(cmd, c));
    };
    switch (cmd.drawMode)
    {
    case DrawCmd::DrawTriangles:
        for (int i = 0; i + 2 < n; i += 3)
            tri(i, i + 1, i + 2);
        break;
    case DrawCmd::DrawTriangleStrip:
        for (int i = 0; i + 2 < n; i++)
        {
            if (i & 1)
                tri(i + 1, i, i + 2);
            else
                tri(i, i + 1, i + 2);
        }
        break;
    case DrawCmd::DrawTriangleFan:
    case DrawCmd::DrawPolygon:
        for (int i = 1; i + 1 < n; i++)
            tri(0, i, i + 1);
        break;
    case DrawCmd::DrawQuads:
        for (int i = 0; i + 3 < n; i += 4)
        {
            tri(i, i + 1, i + 2);
            tri(i, i + 2, i + 3);
        }
        break;
    case DrawCmd::DrawQuadStrip:
        for (int i = 0; i + 3 < n; i += 2)
        {
            tri(i, i + 1, i + 3);
            tri(i, i + 3, i + 2);
        }
        break;
    default: // points and lines are passed through
        for (int i = 0; i < n; i++)
            other.push_back((GLushort)getIndex(cmd, i));
        break;
    }
}


void MeshDrawMgr::makeBuffers()
{
    indexedSets.clear();
    vbo.clear();

    // the vertex arrays have no explicit size, use the highest index
    unsigned int vertexCount = 0;
    const DrawLod* drawLods = drawInfo->getDrawLods();
    for (int lod = 0; lod < drawInfo->getLodCount(); lod++)
        for (int set = 0; set < drawLods[lod].count; set++)
        {
            const DrawSet& drawSet = drawLods[lod].sets[set];
            for (int c = 0; c < drawSet.count; c++)
                for (int i = 0; i < drawSet.cmds[c].count; i++)
                    vertexCount = std::max(vertexCount, getIndex(drawSet.cmds[c], i) + 1);
        }
    if (vertexCount > 0x10000)
    {
        logDebugMessage(1, "MeshDrawMgr: %u vertices do not fit 16-bit indices\n",
                        vertexCount);
        return;
    }

    vbo.set((int)vertexCount,
            reinterpret_cast<GLfloat const*>(drawInfo->getVertices()),
            reinterpret_cast<GLfloat const*>(drawInfo->getNormals()),
            reinterpret_cast<GLfloat const*>(drawInfo->getTexcoords()));

    indexedSets.resize(drawInfo->getLodCount());
    for (int lod = 0; lod < drawInfo->getLodCount(); lod++)
    {
        const DrawLod& drawLod = drawLods[lod];
        indexedSets[lod].resize(drawLod.count);
        for (int set = 0; set < drawLod.count; set++)
        {
            const DrawSet& drawSet = drawLod.sets[set];
            IndexedSet& out = indexedSets[lod][set];
            IndexedCmd tris = { GL_TRIANGLES, {} };
            for (int c = 0; c < drawSet.count; c++)
            {
                const DrawCmd& cmd = drawSet.cmds[c];
                IndexedCmd other = { cmd.drawMode, {} };
                convertCmd(cmd, tris.indices, other.indices);
                if (!other.indices.empty())
                    out.push_back(std::move(other));
            }
            // all polygons of a set go out in a single draw call
            if (!tris.indices.empty())
                out.push_back(std::move(tris));
        }
    }
}


void MeshDrawMgr::executeBuffered(int lod, int set, bool useNormals, bool useTexcoords)
{
    vbo.bind(useNormals, useTexcoords);
    for (const IndexedCmd& cmd : indexedSets[lod][set])
        glDrawElements(cmd.mode, (GLsizei)cmd.indices.size(),
                       GL_UNSIGNED_SHORT, cmd.indices.data());
    OpenGLVertexBuffer::unbind();
}
#endif // __EMSCRIPTEN__


void MeshDrawMgr::executeSet(int lod, int set, bool useNormals, bool useTexcoords)
{
    // FIXME (what is broken?)
    const AnimationInfo* animInfo = drawInfo->getAnimationInfo();
    if (animInfo != nullptr)
    {
        glPushMatrix();
        glRotatef(animInfo->angle, 0.0f, 0.0f, 1.0f);
    }

    const GLuint list = lodLists[lod][set];
#ifdef __EMSCRIPTEN__
    if (!indexedSets.empty())
        executeBuffered(lod, set, useNormals, useTexcoords);
    else
#endif
    if (list != INVALID_GL_LIST_ID)
        glCallList(list);
    else
    {
        auto vertices  = reinterpret_cast<GLfloat const*>(drawInfo->getVertices());
        auto normals   = reinterpret_cast<GLfloat const*>(drawInfo->getNormals());
        auto texcoords = reinterpret_cast<GLfloat const*>(drawInfo->getTexcoords());

        glVertexPointer(3, GL_FLOAT, 0, vertices);

#ifdef __EMSCRIPTEN__
        // only the vertex array is enabled by default here
        if (useNormals)
        {
            glEnableClientState(GL_NORMAL_ARRAY);
            glNormalPointer(GL_FLOAT, 0, normals);
        }
        if (useTexcoords)
        {
            glEnableClientState(GL_TEXTURE_COORD_ARRAY);
            glTexCoordPointer(2, GL_FLOAT, 0, texcoords);
        }

        rawExecuteCommands(lod, set);

        OpenGLVertexBuffer::unbind();
#else
        if (useNormals)
            glNormalPointer(GL_FLOAT, 0, normals);
        else
            glDisableClientState(GL_NORMAL_ARRAY);
        if (useTexcoords)
            glTexCoordPointer(2, GL_FLOAT, 0, texcoords);
        else
            glDisableClientState(GL_TEXTURE_COORD_ARRAY);

        rawExecuteCommands(lod, set);

        if (!useNormals)
            glEnableClientState(GL_NORMAL_ARRAY);
        if (!useTexcoords)
            glEnableClientState(GL_TEXTURE_COORD_ARRAY);
#endif
    }

    if (animInfo != nullptr)
        glPopMatrix();

    return;
}


void MeshDrawMgr::executeSetGeometry(int lod, int set)
{
    // FIXME
    const AnimationInfo* animInfo = drawInfo->getAnimationInfo();
    if (animInfo != NULL)
    {
        glPushMatrix();
        glRotatef(animInfo->angle, 0.0f, 0.0f, 1.0f);
    }

    const GLuint list = lodLists[lod][set];
#ifdef __EMSCRIPTEN__
    if (!indexedSets.empty())
        executeBuffered(lod, set, false, false);
    else
#endif
    if (list != INVALID_GL_LIST_ID)
        glCallList(list);
    else
    {
        auto vertices = reinterpret_cast<GLfloat const *>(drawInfo->getVertices());

        glVertexPointer(3, GL_FLOAT, 0, vertices);
        rawExecuteCommands(lod, set);
    }

    if (animInfo != NULL)
        glPopMatrix();

    return;
}


void MeshDrawMgr::makeLists()
{
#ifdef __EMSCRIPTEN__
    makeBuffers();
#else
    GLenum error;
    int errCount = 0;
    // reset the error state
    while (true)
    {
        error = glGetError();
        if (error == GL_NO_ERROR)
            break;
        errCount++; // avoid a possible spin-lock?
        if (errCount > 666)
        {
            logDebugMessage(1,"MeshDrawMgr::makeLists() glError: %i\n", error);
            return; // don't make the lists, something is borked
        }
    };

    auto vertices  = reinterpret_cast<GLfloat const*>(drawInfo->getVertices());
    auto normals   = reinterpret_cast<GLfloat const*>(drawInfo->getNormals());
    auto texcoords = reinterpret_cast<GLfloat const*>(drawInfo->getTexcoords());

    glVertexPointer(3, GL_FLOAT, 0, vertices);
    glEnableClientState(GL_VERTEX_ARRAY);
    glNormalPointer(GL_FLOAT, 0, normals);
    glEnableClientState(GL_NORMAL_ARRAY);
    glTexCoordPointer(2, GL_FLOAT, 0, texcoords);
    glEnableClientState(GL_TEXTURE_COORD_ARRAY);

    auto lod = 0;
    auto curDrawLod = drawInfo->getDrawLods();

    for (auto &item : lodLists)
    {
        const DrawLod& drawLod = *(curDrawLod++);
        for (auto set = 0; set < drawLod.count; set++)
        {
            const DrawSet& drawSet = drawLod.sets[set];
            if (!drawSet.wantList)
                continue;

            item[set] = glGenLists(1);

            glNewList(item[set], GL_COMPILE);
            {
                rawExecuteCommands(lod, set);
            }
            glEndList();

            error = glGetError();
            if (error != GL_NO_ERROR)
            {
                logDebugMessage(1,"MeshDrawMgr::makeLists() %i/%i glError: %i\n",
                                lod, set, error);
                item[set] = INVALID_GL_LIST_ID;
            }
            else
                logDebugMessage(3,"MeshDrawMgr::makeLists() %i/%i created\n", lod, set);
        }
        lod++;
    }
#endif // __EMSCRIPTEN__

    return;
}


void MeshDrawMgr::freeLists()
{
#ifdef __EMSCRIPTEN__
    vbo.clear();
    indexedSets.clear();
#endif
    for (auto &item : lodLists)
        for (auto &itemSet : item)
            if (itemSet != INVALID_GL_LIST_ID)
            {
                glDeleteLists(itemSet, 1);
                itemSet = INVALID_GL_LIST_ID;
            }

    return;
}


void MeshDrawMgr::initContext(void* data)
{
    ((MeshDrawMgr*)data)->makeLists();
    return;
}


void MeshDrawMgr::freeContext(void* data)
{
    ((MeshDrawMgr*)data)->freeLists();
    return;
}


/******************************************************************************/

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
