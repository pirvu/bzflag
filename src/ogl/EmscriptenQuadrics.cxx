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

// GLU quadrics for the Emscripten build, which has no GLU. The geometry
// comes from QuadricGeometry (the same as libGLU's); each distinct shape is
// triangulated once and kept in a vertex buffer, so drawing one per frame
// (lasers, bolts, spheres) costs a single draw call.

#ifdef __EMSCRIPTEN__

#include "bzfgl.h"

// system headers
#include <map>
#include <memory>
#include <tuple>

// common headers
#include "OpenGLGState.h"
#include "OpenGLVertexBuffer.h"
#include "QuadricGeometry.h"

struct GLUquadric
{
    QuadricStyle style;
};

namespace
{
enum Shape { CylinderShape, SphereShape, DiskShape };

// shape, its parameters, and the style
typedef std::tuple<int, float, float, float, float, float, int, int,
        GLenum, GLenum, bool> ShapeKey;

std::map<ShapeKey, std::unique_ptr<OpenGLVertexBuffer>> shapes;
// shapes with a changing parameter (a laser's length) must not pile up
const size_t maxShapes = 256;
bool contextRegistered = false;

void freeContext(void*)
{
    for (auto& shape : shapes)
        shape.second->release();
}

void initContext(void*)
{
    // buffers are uploaded again on their next draw
}

template <typename Build>
void drawShape(const GLUquadric* q, const ShapeKey& key, Build build)
{
    auto it = shapes.find(key);
    if (it == shapes.end())
    {
        if (!contextRegistered)
        {
            OpenGLGState::registerContextInitializer(freeContext, initContext, NULL);
            contextRegistered = true;
        }
        if (shapes.size() >= maxShapes)
            shapes.clear();

        QuadricPrimitives prims;
        build(prims);
        std::vector<GLfloat> triangles;
        std::vector<int> corners;
        for (const QuadricPrimitives::Primitive& prim : prims.primitives)
        {
            const int n = (int)(prim.vertices.size() / QuadricPrimitives::FloatsPerVertex);
            corners.clear();
            triangulatePrimitive(prim.mode, n, corners);
            for (int c : corners)
            {
                const GLfloat* v = &prim.vertices[c * QuadricPrimitives::FloatsPerVertex];
                triangles.insert(triangles.end(), v, v + QuadricPrimitives::FloatsPerVertex);
            }
        }
        std::unique_ptr<OpenGLVertexBuffer> buffer(new OpenGLVertexBuffer);
        buffer->setInterleaved(triangles);
        it = shapes.emplace(key, std::move(buffer)).first;
    }

    OpenGLVertexBuffer& buffer = *it->second;
    if (buffer.getCount() == 0)
        return;
    // without normals or texcoords the current GL values apply, as in GLU
    buffer.bind(q->style.normals != GLU_NONE, q->style.texture);
    glDrawArrays(GL_TRIANGLES, 0, buffer.getCount());
    OpenGLVertexBuffer::unbind();
}

ShapeKey makeKey(const GLUquadric* q, int shape, float a, float b, float c,
                 float d, float e, int i, int j)
{
    return ShapeKey(shape, a, b, c, d, e, i, j, q->style.normals,
                    q->style.orientation, q->style.texture);
}
}


extern "C"
{

GLUquadric* gluNewQuadric()
{
    return new GLUquadric;
}

void gluDeleteQuadric(GLUquadric* q)
{
    delete q;
}

void gluQuadricDrawStyle(GLUquadric*, GLenum)
{
    // only GLU_FILL is drawn
}

void gluQuadricTexture(GLUquadric* q, GLboolean texture)
{
    q->style.texture = (texture != GL_FALSE);
}

void gluQuadricNormals(GLUquadric* q, GLenum normals)
{
    q->style.normals = normals;
}

void gluQuadricOrientation(GLUquadric* q, GLenum orientation)
{
    q->style.orientation = orientation;
}

void gluCylinder(GLUquadric* q, GLdouble base, GLdouble top, GLdouble height,
                 GLint slices, GLint stacks)
{
    drawShape(q, makeKey(q, CylinderShape, (float)base, (float)top, (float)height,
                         0.0f, 0.0f, slices, stacks),
              [&](QuadricPrimitives& out)
    {
        quadricCylinder(q->style, base, top, height, slices, stacks, out);
    });
}

void gluSphere(GLUquadric* q, GLdouble radius, GLint slices, GLint stacks)
{
    drawShape(q, makeKey(q, SphereShape, (float)radius, 0.0f, 0.0f, 0.0f, 0.0f,
                         slices, stacks),
              [&](QuadricPrimitives& out)
    {
        quadricSphere(q->style, radius, slices, stacks, out);
    });
}

void gluPartialDisk(GLUquadric* q, GLdouble inner, GLdouble outer,
                    GLint slices, GLint loops, GLdouble start, GLdouble sweep)
{
    drawShape(q, makeKey(q, DiskShape, (float)inner, (float)outer, (float)start,
                         (float)sweep, 0.0f, slices, loops),
              [&](QuadricPrimitives& out)
    {
        quadricPartialDisk(q->style, inner, outer, slices, loops, start, sweep, out);
    });
}

void gluDisk(GLUquadric* q, GLdouble inner, GLdouble outer, GLint slices,
             GLint loops)
{
    gluPartialDisk(q, inner, outer, slices, loops, 0.0, 360.0);
}

} // extern "C"

#endif // __EMSCRIPTEN__

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
