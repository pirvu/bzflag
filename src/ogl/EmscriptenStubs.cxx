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

// Emscripten stubs for legacy OpenGL features not supported by WebGL / Emscripten's GL emulation.
// These are placeholders so the link succeeds; a proper port must replace display-list rendering
// with VBO/VAO-based rendering. See docs/PORT_PROGRESS.md "Top remaining Emscripten issues".

#ifdef __EMSCRIPTEN__

#include "bzfgl.h"

// bzfgl.h rewrites some GL calls via macros (glDeleteLists -> bzDeleteLists, etc.).
// Undo those macros so we can define the real GL entry points here.
#ifdef glDeleteLists
#  undef glDeleteLists
#endif
#ifdef glDeleteTextures
#  undef glDeleteTextures
#endif
#ifdef glGenLists
#  undef glGenLists
#endif
#ifdef glNewList
#  undef glNewList
#endif
#ifdef glGenTextures
#  undef glGenTextures
#endif

extern "C"
{

// Display lists — not in WebGL. Return a fake-but-nonzero id and no-op everything.
GLuint glGenLists(GLsizei /*range*/)
{
    static GLuint next = 1;
    return next++;
}

void glNewList(GLuint /*list*/, GLenum /*mode*/) {}
void glEndList() {}
void glCallList(GLuint /*list*/) {}
void glCallLists(GLsizei /*n*/, GLenum /*type*/, const GLvoid* /*lists*/) {}
void glDeleteLists(GLuint /*list*/, GLsizei /*range*/) {}
GLboolean glIsList(GLuint /*list*/) { return GL_FALSE; }
void glListBase(GLuint /*base*/) {}

// Attribute stack — not in WebGL. No-op.
void glPushAttrib(GLbitfield /*mask*/) {}
void glPopAttrib() {}
void glPushClientAttrib(GLbitfield /*mask*/) {}
void glPopClientAttrib() {}

// Immediate-mode rectangle calls — not in WebGL's legacy emulation.
// Emit as GL_QUADS under glBegin/glEnd which emulation DOES handle.
void glRecti(GLint x1, GLint y1, GLint x2, GLint y2)
{
    glBegin(GL_TRIANGLE_STRIP);
    glVertex2i(x1, y1); glVertex2i(x2, y1);
    glVertex2i(x1, y2); glVertex2i(x2, y2);
    glEnd();
}
void glRectf(GLfloat x1, GLfloat y1, GLfloat x2, GLfloat y2)
{
    glBegin(GL_TRIANGLE_STRIP);
    glVertex2f(x1, y1); glVertex2f(x2, y1);
    glVertex2f(x1, y2); glVertex2f(x2, y2);
    glEnd();
}

// Stipple patterns — not in WebGL. No-op.
void glPolygonStipple(const GLubyte* /*pattern*/) {}
void glLineStipple(GLint /*factor*/, GLushort /*pattern*/) {}

// Lighting scalar variants — emulation provides glLightfv/glMaterialfv but
// not the scalar overloads. Forward to the vector form for integer-indexed
// parameters; most call sites want pname GL_SHININESS etc.
void glLighti(GLenum light, GLenum pname, GLint param)
{
    GLfloat v = (GLfloat)param;
    glLightfv(light, pname, &v);
}
void glLightf(GLenum light, GLenum pname, GLfloat param)
{
    glLightfv(light, pname, &param);
}
void glMaterialf(GLenum face, GLenum pname, GLfloat param)
{
    glMaterialfv(face, pname, &param);
}
void glLightModeli(GLenum /*pname*/, GLint /*param*/)
{
    // NOTE: no-op; lighting model state isn't honored under WebGL FFP emulation
}

// Raster logic ops — not in WebGL. No-op.
void glLogicOp(GLenum /*opcode*/) {}

} // extern "C"

// GLU quadrics — <GL/glu.h> declares these but Emscripten doesn't link libGLU.
// No-op stubs: return a dummy pointer and discard draw calls.
// NOTE: no-op; real impl will require a VBO-based quadric generator.
struct GLUquadricStub { int dummy; };

extern "C"
{

GLUquadric* gluNewQuadric()
{
    static GLUquadricStub single;
    return reinterpret_cast<GLUquadric*>(&single);
}
void gluDeleteQuadric(GLUquadric*) {}
void gluQuadricDrawStyle(GLUquadric*, GLenum) {}
void gluQuadricTexture(GLUquadric*, GLboolean) {}
void gluQuadricNormals(GLUquadric*, GLenum) {}
void gluQuadricOrientation(GLUquadric*, GLenum) {}
void gluDisk(GLUquadric*, GLdouble, GLdouble, GLint, GLint) {}
void gluCylinder(GLUquadric*, GLdouble, GLdouble, GLdouble, GLint, GLint) {}
void gluSphere(GLUquadric*, GLdouble, GLint, GLint) {}

// gluProject — minimal identity-like fallback so call sites in HUDRenderer
// at least compile and run without a crash. Real projection math lives in
// BZFlag's own matrix utilities too; these stubs just keep the link valid.
GLint gluProject(GLdouble objX, GLdouble objY, GLdouble objZ,
                 const GLdouble* /*model*/, const GLdouble* /*proj*/,
                 const GLint* view,
                 GLdouble* winX, GLdouble* winY, GLdouble* winZ)
{
    if (winX) *winX = objX + (view ? view[0] : 0);
    if (winY) *winY = objY + (view ? view[1] : 0);
    if (winZ) *winZ = objZ;
    return GL_TRUE;
}

} // extern "C"

#endif // __EMSCRIPTEN__
