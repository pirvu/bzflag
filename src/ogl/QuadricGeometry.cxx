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

// The loops below follow the SGI GLU quadric code (as shipped in Mesa's
// libGLU), including its float/double arithmetic, so the vertices match.

// interface header
#include "QuadricGeometry.h"

// system headers
#include <math.h>

static const int CacheSize = 240;
static const double Pi = 3.14159265358979323846;

static inline GLfloat Sin(double x)
{
    return (GLfloat)sin(x);
}
static inline GLfloat Cos(double x)
{
    return (GLfloat)cos(x);
}


void QuadricPrimitives::begin(GLenum mode)
{
    primitives.push_back(Primitive());
    primitives.back().mode = mode;
}


void QuadricPrimitives::end()
{
}


void QuadricPrimitives::normal(GLfloat x, GLfloat y, GLfloat z)
{
    curNormal[0] = x;
    curNormal[1] = y;
    curNormal[2] = z;
}


void QuadricPrimitives::texCoord(GLfloat s, GLfloat t)
{
    curTexCoord[0] = s;
    curTexCoord[1] = t;
}


void QuadricPrimitives::vertex(GLfloat x, GLfloat y, GLfloat z)
{
    const GLfloat v[FloatsPerVertex] =
    {
        x, y, z, curNormal[0], curNormal[1], curNormal[2],
        curTexCoord[0], curTexCoord[1]
    };
    std::vector<GLfloat>& dst = primitives.back().vertices;
    dst.insert(dst.end(), v, v + FloatsPerVertex);
}


void quadricCylinder(const QuadricStyle& style, double baseRadius,
                     double topRadius, double height, int slices, int stacks,
                     QuadricPrimitives& out)
{
    GLfloat sinCache[CacheSize], cosCache[CacheSize];
    GLfloat sinCache2[CacheSize], cosCache2[CacheSize];

    if (slices >= CacheSize)
        slices = CacheSize - 1;
    if (slices < 2 || stacks < 1 || baseRadius < 0.0 || topRadius < 0.0 ||
            height < 0.0)
        return;

    // length is needed for the normals
    const GLfloat deltaRadius = (GLfloat)(baseRadius - topRadius);
    const GLfloat length = (GLfloat)sqrt(deltaRadius * deltaRadius + height * height);
    if (length == 0.0)
        return;

    const bool smooth = (style.normals != GLU_NONE);
    const bool outside = (style.orientation == GLU_OUTSIDE);
    const GLfloat zNormal = deltaRadius / length;
    const GLfloat xyNormalRatio = (GLfloat)(height / length);

    for (int i = 0; i < slices; i++)
    {
        const GLfloat angle = (GLfloat)(2 * Pi * i / slices);
        sinCache2[i] = (outside ? xyNormalRatio : -xyNormalRatio) * Sin(angle);
        cosCache2[i] = (outside ? xyNormalRatio : -xyNormalRatio) * Cos(angle);
        sinCache[i] = Sin(angle);
        cosCache[i] = Cos(angle);
    }
    sinCache[slices] = sinCache[0];
    cosCache[slices] = cosCache[0];
    sinCache2[slices] = sinCache2[0];
    cosCache2[slices] = cosCache2[0];

    for (int j = 0; j < stacks; j++)
    {
        const GLfloat zLow = (GLfloat)(j * height / stacks);
        const GLfloat zHigh = (GLfloat)((j + 1) * height / stacks);
        const GLfloat radiusLow = (GLfloat)(baseRadius - deltaRadius * ((float)j / stacks));
        const GLfloat radiusHigh = (GLfloat)(baseRadius - deltaRadius * ((float)(j + 1) / stacks));

        out.begin(GL_QUAD_STRIP);
        for (int i = 0; i <= slices; i++)
        {
            if (smooth)
                out.normal(sinCache2[i], cosCache2[i], zNormal);
            const GLfloat s = 1 - (float)i / slices;
            if (outside)
            {
                if (style.texture)
                    out.texCoord(s, (float)j / stacks);
                out.vertex(radiusLow * sinCache[i], radiusLow * cosCache[i], zLow);
                if (style.texture)
                    out.texCoord(s, (float)(j + 1) / stacks);
                out.vertex(radiusHigh * sinCache[i], radiusHigh * cosCache[i], zHigh);
            }
            else
            {
                if (style.texture)
                    out.texCoord(s, (float)(j + 1) / stacks);
                out.vertex(radiusHigh * sinCache[i], radiusHigh * cosCache[i], zHigh);
                if (style.texture)
                    out.texCoord(s, (float)j / stacks);
                out.vertex(radiusLow * sinCache[i], radiusLow * cosCache[i], zLow);
            }
        }
        out.end();
    }
}


void quadricSphere(const QuadricStyle& style, double radius, int slices,
                   int stacks, QuadricPrimitives& out)
{
    GLfloat sinCache1a[CacheSize], cosCache1a[CacheSize];
    GLfloat sinCache2a[CacheSize], cosCache2a[CacheSize];
    GLfloat sinCache1b[CacheSize], cosCache1b[CacheSize];
    GLfloat sinCache2b[CacheSize], cosCache2b[CacheSize];

    if (slices >= CacheSize)
        slices = CacheSize - 1;
    if (stacks >= CacheSize)
        stacks = CacheSize - 1;
    if (slices < 2 || stacks < 1 || radius < 0.0)
        return;

    const bool smooth = (style.normals != GLU_NONE);
    const bool outside = (style.orientation == GLU_OUTSIDE);

    for (int i = 0; i < slices; i++)
    {
        const GLfloat angle = (GLfloat)(2 * Pi * i / slices);
        sinCache1a[i] = Sin(angle);
        cosCache1a[i] = Cos(angle);
        sinCache2a[i] = sinCache1a[i];
        cosCache2a[i] = cosCache1a[i];
    }
    for (int j = 0; j <= stacks; j++)
    {
        const GLfloat angle = (GLfloat)(Pi * j / stacks);
        sinCache2b[j] = outside ? Sin(angle) : -Sin(angle);
        cosCache2b[j] = outside ? Cos(angle) : -Cos(angle);
        sinCache1b[j] = (GLfloat)(radius * Sin(angle));
        cosCache1b[j] = (GLfloat)(radius * Cos(angle));
    }
    // make sure it comes to a point
    sinCache1b[0] = 0;
    sinCache1b[stacks] = 0;

    sinCache1a[slices] = sinCache1a[0];
    cosCache1a[slices] = cosCache1a[0];
    sinCache2a[slices] = sinCache2a[0];
    cosCache2a[slices] = cosCache2a[0];

    int start, finish;
    if (!style.texture)
    {
        // the ends are triangle fans when not texturing (with texturing the
        // apex needs a different texture coordinate for every neighbour)
        start = 1;
        finish = stacks - 1;

        // low end first (j == 0 iteration)
        GLfloat sintemp2 = sinCache1b[1];
        GLfloat zHigh = cosCache1b[1];
        GLfloat sintemp3 = sinCache2b[1];
        GLfloat costemp3 = cosCache2b[1];
        if (smooth)
            out.normal(sinCache2a[0] * sinCache2b[0], cosCache2a[0] * sinCache2b[0],
                       cosCache2b[0]);
        out.begin(GL_TRIANGLE_FAN);
        out.vertex(0.0f, 0.0f, (GLfloat)radius);
        for (int k = 0; k <= slices; k++)
        {
            const int i = outside ? slices - k : k;
            if (smooth)
                out.normal(sinCache2a[i] * sintemp3, cosCache2a[i] * sintemp3, costemp3);
            out.vertex(sintemp2 * sinCache1a[i], sintemp2 * cosCache1a[i], zHigh);
        }
        out.end();

        // high end next (j == stacks-1 iteration)
        sintemp2 = sinCache1b[stacks - 1];
        zHigh = cosCache1b[stacks - 1];
        sintemp3 = sinCache2b[stacks - 1];
        costemp3 = cosCache2b[stacks - 1];
        // GLU indexes a slice cache with the stack count here; the sine of
        // the pole angle is zero, so only the z component matters
        if (smooth)
            out.normal(0.0f * sinCache2b[stacks], 0.0f * sinCache2b[stacks],
                       cosCache2b[stacks]);
        out.begin(GL_TRIANGLE_FAN);
        out.vertex(0.0f, 0.0f, (GLfloat)-radius);
        for (int k = 0; k <= slices; k++)
        {
            const int i = outside ? k : slices - k;
            if (smooth)
                out.normal(sinCache2a[i] * sintemp3, cosCache2a[i] * sintemp3, costemp3);
            out.vertex(sintemp2 * sinCache1a[i], sintemp2 * cosCache1a[i], zHigh);
        }
        out.end();
    }
    else
    {
        start = 0;
        finish = stacks;
    }

    for (int j = start; j < finish; j++)
    {
        const GLfloat zLow = cosCache1b[j];
        const GLfloat zHigh = cosCache1b[j + 1];
        const GLfloat sintemp1 = sinCache1b[j];
        const GLfloat sintemp2 = sinCache1b[j + 1];
        const GLfloat sintemp3 = outside ? sinCache2b[j + 1] : sinCache2b[j];
        const GLfloat costemp3 = outside ? cosCache2b[j + 1] : cosCache2b[j];
        const GLfloat sintemp4 = outside ? sinCache2b[j] : sinCache2b[j + 1];
        const GLfloat costemp4 = outside ? cosCache2b[j] : cosCache2b[j + 1];

        out.begin(GL_QUAD_STRIP);
        for (int i = 0; i <= slices; i++)
        {
            const GLfloat s = 1 - (float)i / slices;
            if (smooth)
                out.normal(sinCache2a[i] * sintemp3, cosCache2a[i] * sintemp3, costemp3);
            if (outside)
            {
                if (style.texture)
                    out.texCoord(s, 1 - (float)(j + 1) / stacks);
                out.vertex(sintemp2 * sinCache1a[i], sintemp2 * cosCache1a[i], zHigh);
            }
            else
            {
                if (style.texture)
                    out.texCoord(s, 1 - (float)j / stacks);
                out.vertex(sintemp1 * sinCache1a[i], sintemp1 * cosCache1a[i], zLow);
            }
            if (smooth)
                out.normal(sinCache2a[i] * sintemp4, cosCache2a[i] * sintemp4, costemp4);
            if (outside)
            {
                if (style.texture)
                    out.texCoord(s, 1 - (float)j / stacks);
                out.vertex(sintemp1 * sinCache1a[i], sintemp1 * cosCache1a[i], zLow);
            }
            else
            {
                if (style.texture)
                    out.texCoord(s, 1 - (float)(j + 1) / stacks);
                out.vertex(sintemp2 * sinCache1a[i], sintemp2 * cosCache1a[i], zHigh);
            }
        }
        out.end();
    }
}


void quadricPartialDisk(const QuadricStyle& style, double innerRadius,
                        double outerRadius, int slices, int loops,
                        double startAngle, double sweepAngle,
                        QuadricPrimitives& out)
{
    GLfloat sinCache[CacheSize], cosCache[CacheSize];

    if (slices >= CacheSize)
        slices = CacheSize - 1;
    if (slices < 2 || loops < 1 || outerRadius <= 0.0 || innerRadius < 0.0 ||
            innerRadius > outerRadius)
        return;

    if (sweepAngle < -360.0)
        sweepAngle = 360.0;
    if (sweepAngle > 360.0)
        sweepAngle = 360.0;
    if (sweepAngle < 0)
    {
        startAngle += sweepAngle;
        sweepAngle = -sweepAngle;
    }

    const bool outside = (style.orientation == GLU_OUTSIDE);
    const GLfloat deltaRadius = (GLfloat)(outerRadius - innerRadius);

    const GLfloat angleOffset = (GLfloat)(startAngle / 180.0 * Pi);
    for (int i = 0; i <= slices; i++)
    {
        const GLfloat angle = (GLfloat)(angleOffset + ((Pi * sweepAngle) / 180.0) * i / slices);
        sinCache[i] = Sin(angle);
        cosCache[i] = Cos(angle);
    }
    if (sweepAngle == 360.0)
    {
        sinCache[slices] = sinCache[0];
        cosCache[slices] = cosCache[0];
    }

    if (style.normals != GLU_NONE)
        out.normal(0.0f, 0.0f, outside ? 1.0f : -1.0f);

    int finish;
    GLfloat texLow = 0.0f, texHigh = 0.0f;
    if (innerRadius == 0.0)
    {
        finish = loops - 1;
        // triangle fan for the inner polygons
        out.begin(GL_TRIANGLE_FAN);
        if (style.texture)
            out.texCoord(0.5f, 0.5f);
        out.vertex(0.0f, 0.0f, 0.0f);
        const GLfloat radiusLow = (GLfloat)(outerRadius - deltaRadius * ((float)(loops - 1) / loops));
        if (style.texture)
            texLow = (GLfloat)(radiusLow / outerRadius / 2);
        for (int k = 0; k <= slices; k++)
        {
            const int i = outside ? slices - k : k;
            if (style.texture)
                out.texCoord(texLow * sinCache[i] + 0.5f, texLow * cosCache[i] + 0.5f);
            out.vertex(radiusLow * sinCache[i], radiusLow * cosCache[i], 0.0f);
        }
        out.end();
    }
    else
        finish = loops;

    for (int j = 0; j < finish; j++)
    {
        const GLfloat radiusLow = (GLfloat)(outerRadius - deltaRadius * ((float)j / loops));
        const GLfloat radiusHigh = (GLfloat)(outerRadius - deltaRadius * ((float)(j + 1) / loops));
        if (style.texture)
        {
            texLow = (GLfloat)(radiusLow / outerRadius / 2);
            texHigh = (GLfloat)(radiusHigh / outerRadius / 2);
        }

        out.begin(GL_QUAD_STRIP);
        for (int i = 0; i <= slices; i++)
        {
            for (int pass = 0; pass < 2; pass++)
            {
                // outside: the low radius first
                const bool low = outside ? (pass == 0) : (pass == 1);
                const GLfloat r = low ? radiusLow : radiusHigh;
                const GLfloat t = low ? texLow : texHigh;
                if (style.texture)
                    out.texCoord(t * sinCache[i] + 0.5f, t * cosCache[i] + 0.5f);
                out.vertex(r * sinCache[i], r * cosCache[i], 0.0f);
            }
        }
        out.end();
    }
}

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
