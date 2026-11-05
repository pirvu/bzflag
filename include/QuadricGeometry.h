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

/* QuadricGeometry:
 *  The geometry of the GLU quadrics (gluSphere, gluCylinder, gluDisk,
 *  gluPartialDisk) as lists of primitives, for the Emscripten build where
 *  there is no GLU. It follows the reference SGI/Mesa implementation for
 *  the GLU_FILL draw style, emitting the same primitives and vertices with
 *  the same normals and texture coordinates.
 *
 *  Supported: GLU_FILL (other draw styles are drawn filled), GLU_SMOOTH and
 *  GLU_NONE normals (GLU_FLAT is treated as GLU_SMOOTH), GLU_OUTSIDE and
 *  GLU_INSIDE orientation, with or without texture coordinates.
 */

#ifndef _QUADRIC_GEOMETRY_H
#define _QUADRIC_GEOMETRY_H

#include <vector>
#include <GL/gl.h>
#include <GL/glu.h>

struct QuadricStyle
{
    GLenum normals = GLU_SMOOTH;
    GLenum orientation = GLU_OUTSIDE;
    bool texture = false;
};

// Records primitives like immediate mode: normal() and texCoord() set the
// current values that each vertex() picks up.
class QuadricPrimitives
{
public:
    static const int FloatsPerVertex = 8; // position, normal, texcoord

    struct Primitive
    {
        GLenum mode;
        std::vector<GLfloat> vertices;
    };

    void begin(GLenum mode);
    void end();
    void normal(GLfloat x, GLfloat y, GLfloat z);
    void texCoord(GLfloat s, GLfloat t);
    void vertex(GLfloat x, GLfloat y, GLfloat z);

    std::vector<Primitive> primitives;

private:
    GLfloat curNormal[3] = { 0.0f, 0.0f, 1.0f };
    GLfloat curTexCoord[2] = { 0.0f, 0.0f };
};

void quadricCylinder(const QuadricStyle& style, double baseRadius,
                     double topRadius, double height, int slices, int stacks,
                     QuadricPrimitives& out);
void quadricSphere(const QuadricStyle& style, double radius, int slices,
                   int stacks, QuadricPrimitives& out);
void quadricPartialDisk(const QuadricStyle& style, double innerRadius,
                        double outerRadius, int slices, int loops,
                        double startAngle, double sweepAngle,
                        QuadricPrimitives& out);

#endif // _QUADRIC_GEOMETRY_H

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
