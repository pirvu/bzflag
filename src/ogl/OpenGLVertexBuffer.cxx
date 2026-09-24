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

// interface header
#include "OpenGLVertexBuffer.h"

#ifdef __EMSCRIPTEN__

// byte offsets inside one interleaved vertex
static const int vertexStride = OpenGLVertexBuffer::FloatsPerVertex * sizeof(GLfloat);
static const GLvoid* const normalOffset = (const GLvoid*)(3 * sizeof(GLfloat));
static const GLvoid* const texcoordOffset = (const GLvoid*)(6 * sizeof(GLfloat));


OpenGLVertexBuffer::OpenGLVertexBuffer() : count(0), buffer(0), dirty(false)
{
}


OpenGLVertexBuffer::~OpenGLVertexBuffer()
{
    release();
}


void OpenGLVertexBuffer::set(int _count, const GLfloat* vertices,
                             const GLfloat* normals, const GLfloat* texcoords)
{
    count = _count;
    data.resize(count * FloatsPerVertex);
    GLfloat* dst = data.data();
    for (int i = 0; i < count; i++)
    {
        dst[0] = vertices[i * 3 + 0];
        dst[1] = vertices[i * 3 + 1];
        dst[2] = vertices[i * 3 + 2];
        dst[3] = normals ? normals[i * 3 + 0] : 0.0f;
        dst[4] = normals ? normals[i * 3 + 1] : 0.0f;
        dst[5] = normals ? normals[i * 3 + 2] : 1.0f;
        dst[6] = texcoords ? texcoords[i * 2 + 0] : 0.0f;
        dst[7] = texcoords ? texcoords[i * 2 + 1] : 0.0f;
        dst += FloatsPerVertex;
    }
    dirty = true;
}


void OpenGLVertexBuffer::setInterleaved(std::vector<GLfloat>& _data)
{
    data.swap(_data);
    count = (int)(data.size() / FloatsPerVertex);
    dirty = true;
}


void OpenGLVertexBuffer::bind(bool useNormals, bool useTexcoords)
{
    if (buffer == 0)
    {
        glGenBuffers(1, &buffer);
        dirty = true;
    }
    glBindBuffer(GL_ARRAY_BUFFER, buffer);
    if (dirty)
    {
        glBufferData(GL_ARRAY_BUFFER, data.size() * sizeof(GLfloat),
                     data.data(), GL_STATIC_DRAW);
        dirty = false;
    }

    // with a buffer bound, the "pointers" are byte offsets into it
    glEnableClientState(GL_VERTEX_ARRAY);
    glVertexPointer(3, GL_FLOAT, vertexStride, (const GLvoid*)0);
    if (useNormals)
    {
        glEnableClientState(GL_NORMAL_ARRAY);
        glNormalPointer(GL_FLOAT, vertexStride, normalOffset);
    }
    else
        glDisableClientState(GL_NORMAL_ARRAY);
    if (useTexcoords)
    {
        glEnableClientState(GL_TEXTURE_COORD_ARRAY);
        glTexCoordPointer(2, GL_FLOAT, vertexStride, texcoordOffset);
    }
    else
        glDisableClientState(GL_TEXTURE_COORD_ARRAY);
}


void OpenGLVertexBuffer::unbind()
{
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glDisableClientState(GL_NORMAL_ARRAY);
    glDisableClientState(GL_TEXTURE_COORD_ARRAY);
}


void OpenGLVertexBuffer::release()
{
    if (buffer != 0)
    {
        glDeleteBuffers(1, &buffer);
        buffer = 0;
    }
    dirty = true;
}


void OpenGLVertexBuffer::clear()
{
    release();
    std::vector<GLfloat>().swap(data);
    count = 0;
}

#endif // __EMSCRIPTEN__

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
