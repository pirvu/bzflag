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

/* OpenGLVertexBuffer:
 *  Static geometry kept in a GPU vertex buffer, for the Emscripten build
 *  where display lists don't exist.
 *
 *  Vertices are stored interleaved (position, normal, texcoord; 32 bytes
 *  each). Emscripten's GL emulation only has a fast path for client arrays
 *  that share one stride; separate arrays go through a slow per-vertex copy
 *  in JavaScript that also rewrites the saved array pointers, so later draws
 *  that set fewer arrays read stale data.
 *
 *  Usage:
 *    buffer.bind(useNormals, useTexcoords);
 *    glDrawArrays(...) / glDrawElements(..., GL_UNSIGNED_SHORT, indices);
 *    OpenGLVertexBuffer::unbind();
 *
 *  bind() sets the client array state explicitly, and unbind() restores the
 *  Emscripten default (only GL_VERTEX_ARRAY enabled) and unbinds the buffer,
 *  which must happen before any glBegin()/glEnd() drawing.
 */

#ifndef _OPENGL_VERTEX_BUFFER_H
#define _OPENGL_VERTEX_BUFFER_H

#include "common.h"

#ifdef __EMSCRIPTEN__

#include <vector>
#include "bzfgl.h"

class OpenGLVertexBuffer
{
public:
    static const int FloatsPerVertex = 8;

    OpenGLVertexBuffer();
    ~OpenGLVertexBuffer();

    // replace the contents; normals and texcoords may be NULL. The data is
    // copied and uploaded to the GPU on the next bind().
    void set(int count, const GLfloat* vertices,
             const GLfloat* normals, const GLfloat* texcoords);
    // replace the contents with already interleaved vertices
    // (FloatsPerVertex floats each)
    void setInterleaved(std::vector<GLfloat>& data);

    int getCount() const
    {
        return count;
    }

    void bind(bool useNormals, bool useTexcoords);
    static void unbind();

    // free the GPU buffer (for context loss); the data is kept and
    // uploaded again on the next bind()
    void release();
    // free everything
    void clear();

private:
    OpenGLVertexBuffer(const OpenGLVertexBuffer&);
    OpenGLVertexBuffer& operator=(const OpenGLVertexBuffer&);

    std::vector<GLfloat> data;
    int count;
    GLuint buffer;
    bool dirty;
};

#endif // __EMSCRIPTEN__

#endif // _OPENGL_VERTEX_BUFFER_H

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
