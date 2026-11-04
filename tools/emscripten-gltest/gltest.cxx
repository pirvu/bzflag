// Pixel comparison tests for the Emscripten GL paths of the browser port.
//
// Each case draws the same thing twice through Emscripten's
// LEGACY_GL_EMULATION: once the old way (immediate mode / per-glyph
// draws) and once the new way (OpenGLVertexBuffer, triangulatePrimitive,
// batched client arrays), reads the pixels back and compares them.
// Built with the real src/ogl/OpenGLVertexBuffer.cxx (vertex buffers and
// triangulatePrimitive). The glyph quads mirror TextureFont::renderGlyph()
// and TextureFont::appendGlyph(), which need the whole font system.
//
// Run with tools/emscripten-gltest/run.sh.

#include <GL/glut.h>
#include <emscripten.h>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <functional>
#include "OpenGLVertexBuffer.h"

static const int W = 256, H = 256;
static int failures = 0;
static GLuint checker = 0;

typedef std::vector<unsigned char> Image;

static Image render(const std::function<void()>& draw)
{
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    draw();
    Image img(W * H * 4);
    glReadPixels(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, img.data());
    return img;
}

static int litPixels(const Image& a)
{
    int n = 0;
    for (int i = 0; i < W * H; i++)
        if (a[i * 4] > 8 || a[i * 4 + 1] > 8 || a[i * 4 + 2] > 8)
            n++;
    return n;
}

static int diffPixels(const Image& a, const Image& b)
{
    int n = 0;
    for (int i = 0; i < W * H; i++)
        for (int c = 0; c < 3; c++)
            if (abs((int)a[i * 4 + c] - (int)b[i * 4 + c]) > 2)
            {
                n++;
                break;
            }
    return n;
}

static void check(const char* name, const Image& ref, const Image& got)
{
    const int lit = litPixels(ref), diff = diffPixels(ref, got);
    const bool ok = lit > 500 && diff == 0;
    printf("%s %-58s lit=%5d diff=%d\n", ok ? "PASS" : "FAIL", name, lit, diff);
    if (!ok)
        failures++;
}

static void setup2D()
{
    glViewport(0, 0, W, H);
    glMatrixMode(GL_PROJECTION);
    glLoadIdentity();
    glOrtho(0, W, 0, H, -1, 1);
    glMatrixMode(GL_MODELVIEW);
    glLoadIdentity();
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_LIGHTING);
    // winding mistakes show up as missing triangles
    glEnable(GL_CULL_FACE);
    glCullFace(GL_BACK);
    glFrontFace(GL_CCW);
}

static void makeChecker()
{
    unsigned char tex[16 * 16 * 4];
    for (int y = 0; y < 16; y++)
        for (int x = 0; x < 16; x++)
        {
            unsigned char* p = tex + (y * 16 + x) * 4;
            const bool on = ((x / 2) + (y / 2)) & 1;
            p[0] = on ? 255 : 40;
            p[1] = (unsigned char)(x * 16);
            p[2] = (unsigned char)(y * 16);
            p[3] = 255;
        }
    glGenTextures(1, &checker);
    glBindTexture(GL_TEXTURE_2D, checker);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 16, 16, 0, GL_RGBA, GL_UNSIGNED_BYTE, tex);
}

// a primitive: interleaved vertices (8 floats: pos, normal, texcoord)
struct Prim
{
    GLenum mode;
    std::vector<GLfloat> v;
    void add(float x, float y, float u, float t)
    {
        const GLfloat a[8] = { x, y, 0, 0, 0, 1, u, t };
        v.insert(v.end(), a, a + 8);
    }
    int count() const
    {
        return (int)v.size() / 8;
    }
};

static void drawImmediate(const Prim& p, GLenum mode)
{
    glBegin(mode);
    for (int i = 0; i < p.count(); i++)
    {
        const GLfloat* a = &p.v[i * 8];
        glNormal3f(a[3], a[4], a[5]);
        glTexCoord2f(a[6], a[7]);
        glVertex3f(a[0], a[1], a[2]);
    }
    glEnd();
}

// the shapes used in the tank models: strips and fans, CCW front faces
static std::vector<Prim> tankLikePrims()
{
    std::vector<Prim> prims;
    Prim strip = { GL_TRIANGLE_STRIP, {} };
    for (int i = 0; i < 9; i++)
    {
        const float x = 10 + i * 25.0f;
        strip.add(x, 20, i / 8.0f, 0);
        strip.add(x + 5, 110, i / 8.0f, 1);
    }
    prims.push_back(strip);
    Prim fan = { GL_TRIANGLE_FAN, {} };
    fan.add(128, 180, 0.5f, 0.5f);
    for (int i = 0; i <= 10; i++)
    {
        const float a = (float)(i * 2.0 * M_PI / 10.0);
        fan.add(128 + 60 * cosf(a), 180 + 60 * sinf(a), 0.5f + 0.5f * cosf(a), 0.5f + 0.5f * sinf(a));
    }
    prims.push_back(fan);
    Prim tris = { GL_TRIANGLES, {} };
    tris.add(10, 130, 0, 0);
    tris.add(60, 130, 1, 0);
    tris.add(35, 160, 0.5f, 1);
    prims.push_back(tris);
    return prims;
}

// what TankGeometryMgr does: record the primitives into one triangle list
static void fillBuffer(OpenGLVertexBuffer& vbo, const std::vector<Prim>& prims)
{
    std::vector<GLfloat> tri;
    for (const Prim& p : prims)
    {
        std::vector<int> corners;
        triangulatePrimitive(p.mode, p.count(), corners);
        for (int c : corners)
            tri.insert(tri.end(), &p.v[c * 8], &p.v[c * 8] + 8);
    }
    vbo.setInterleaved(tri);
}

static void textured(bool on)
{
    if (on)
    {
        glEnable(GL_TEXTURE_2D);
        glBindTexture(GL_TEXTURE_2D, checker);
    }
    else
        glDisable(GL_TEXTURE_2D);
}

static void testTankParts()
{
    const std::vector<Prim> prims = tankLikePrims();
    OpenGLVertexBuffer vbo;
    fillBuffer(vbo, prims);

    glColor4f(1, 1, 1, 1);
    textured(true);
    Image ref = render([&] { for (const Prim& p : prims) drawImmediate(p, p.mode); });
    Image got = render([&]
    {
        vbo.bind(true, true);
        glDrawArrays(GL_TRIANGLES, 0, vbo.getCount());
        OpenGLVertexBuffer::unbind();
    });
    check("tank parts: VBO triangles == immediate strips/fans", ref, got);

    // shadow pass: same buffer without normals/texcoords, untextured
    textured(false);
    glColor4f(0.2f, 0.9f, 0.3f, 1);
    ref = render([&] { for (const Prim& p : prims) drawImmediate(p, p.mode); });
    got = render([&]
    {
        vbo.bind(false, false);
        glDrawArrays(GL_TRIANGLES, 0, vbo.getCount());
        OpenGLVertexBuffer::unbind();
    });
    check("tank shadow: VBO without normals/texcoords", ref, got);

    // after unbind(), immediate mode must work as before (no VBO left bound,
    // no stale arrays enabled)
    textured(true);
    glColor4f(1, 1, 1, 1);
    ref = render([&] { for (const Prim& p : prims) drawImmediate(p, p.mode); });
    got = render([&]
    {
        vbo.bind(true, true);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        OpenGLVertexBuffer::unbind();
        glClear(GL_COLOR_BUFFER_BIT);
        for (const Prim& p : prims) drawImmediate(p, p.mode);
    });
    check("immediate mode after a VBO draw is unaffected", ref, got);

    // context loss: release() then bind() must upload again
    vbo.release();
    got = render([&]
    {
        vbo.bind(true, true);
        glDrawArrays(GL_TRIANGLES, 0, vbo.getCount());
        OpenGLVertexBuffer::unbind();
    });
    check("VBO re-uploads after release() (context loss)", ref, got);
}

static void testMeshIndexed()
{
    // vertices stored in shuffled order behind 40 unused ones, so the
    // indices are high and not 0..n: the old client-array path copied
    // only as many vertices as there were indices
    const int pad = 40;
    std::vector<Prim> prims;
    Prim quads = { GL_QUADS, {} };
    for (int i = 0; i < 3; i++)
    {
        const float x = 10 + i * 80.0f;
        quads.add(x, 10, 0, 0);
        quads.add(x + 60, 10, 1, 0);
        quads.add(x + 60, 70, 1, 1);
        quads.add(x, 70, 0, 1);
    }
    prims.push_back(quads);
    Prim qstrip = { GL_QUAD_STRIP, {} };
    for (int i = 0; i < 5; i++)
    {
        const float x = 10 + i * 55.0f;
        qstrip.add(x, 90, i / 4.0f, 0);
        qstrip.add(x + 10, 150, i / 4.0f, 1);
    }
    prims.push_back(qstrip);
    Prim poly = { GL_POLYGON, {} };
    for (int i = 0; i < 7; i++)
    {
        const float a = (float)(i * 2.0 * M_PI / 7.0);
        poly.add(128 + 50 * cosf(a), 205 + 45 * sinf(a), 0.5f + 0.5f * cosf(a), 0.5f + 0.5f * sinf(a));
    }
    prims.push_back(poly);

    // vertex array: padding, then every primitive's vertices reversed
    std::vector<GLfloat> pos, nrm, tex;
    for (int i = 0; i < pad; i++)
    {
        pos.insert(pos.end(), { 0, 0, 0 });
        nrm.insert(nrm.end(), { 0, 0, 1 });
        tex.insert(tex.end(), { 0, 0 });
    }
    std::vector<std::vector<int>> where;
    int total = 0;
    for (const Prim& p : prims)
        total += p.count();
    std::vector<GLfloat> P(total * 3), N(total * 3), T(total * 2);
    int slot = total;
    for (const Prim& p : prims)
    {
        std::vector<int> idx;
        for (int i = 0; i < p.count(); i++)
        {
            const int s = --slot;
            const GLfloat* a = &p.v[i * 8];
            P[s * 3] = a[0]; P[s * 3 + 1] = a[1]; P[s * 3 + 2] = a[2];
            N[s * 3] = a[3]; N[s * 3 + 1] = a[4]; N[s * 3 + 2] = a[5];
            T[s * 2] = a[6]; T[s * 2 + 1] = a[7];
            idx.push_back(pad + s);
        }
        where.push_back(idx);
    }
    pos.insert(pos.end(), P.begin(), P.end());
    nrm.insert(nrm.end(), N.begin(), N.end());
    tex.insert(tex.end(), T.begin(), T.end());

    // what MeshDrawMgr does: one buffer, 16-bit triangle indices
    OpenGLVertexBuffer vbo;
    vbo.set(pad + total, pos.data(), nrm.data(), tex.data());
    std::vector<GLushort> indices;
    for (size_t k = 0; k < prims.size(); k++)
    {
        std::vector<int> corners;
        triangulatePrimitive(prims[k].mode, prims[k].count(), corners);
        for (int c : corners)
            indices.push_back((GLushort)where[k][c]);
    }

    glColor4f(1, 1, 1, 1);
    textured(true);
    // references: GL_QUADS is emulated; a quad strip is the same surface as
    // a triangle strip and a convex polygon the same as a fan
    Image ref = render([&]
    {
        drawImmediate(prims[0], GL_QUADS);
        drawImmediate(prims[1], GL_TRIANGLE_STRIP);
        drawImmediate(prims[2], GL_TRIANGLE_FAN);
    });
    Image got = render([&]
    {
        vbo.bind(true, true);
        glDrawElements(GL_TRIANGLES, (GLsizei)indices.size(), GL_UNSIGNED_SHORT, indices.data());
        OpenGLVertexBuffer::unbind();
    });
    check("meshes: indexed quads/quad strip/polygon from VBO", ref, got);
}

// fonts: same glyph layout as TextureFont (initialDist, start/end, fullWidth)
struct Glyph
{
    int initialDist, startX, endX, startY, endY, fullWidth;
};
static const Glyph glyphs[] =
{
    { 1, 0, 6, 0, 10, 8 }, { 0, 6, 10, 0, 10, 5 }, { 2, 10, 16, 4, 16, 9 }, { 0, 0, 0, 0, 0, 4 }
};
static const int texSize = 16;

static void renderGlyph(const Glyph& g)    // old per-glyph path
{
    const float initiX = (float)g.initialDist;
    const float fFontY = (float)(g.endY - g.startY);
    const float fFontX = (float)(g.endX - g.startX);
    const float sx = (float)g.startX / texSize, ex = (float)g.endX / texSize;
    const float sy = (float)g.startY / texSize, ey = (float)g.endY / texSize;
    glBegin(GL_TRIANGLE_STRIP);
    glTexCoord2f(sx, 1.0f - sy);
    glVertex3f(initiX, fFontY, 0.0f);
    glTexCoord2f(sx, 1.0f - ey);
    glVertex3f(initiX, 0.0f, 0.0f);
    glTexCoord2f(ex, 1.0f - sy);
    glVertex3f(initiX + fFontX, fFontY, 0.0f);
    glTexCoord2f(ex, 1.0f - ey);
    glVertex3f(initiX + fFontX, 0.0f, 0.0f);
    glEnd();
    glTranslatef((float)g.fullWidth, 0.0f, 0.0f);
}

static void appendGlyph(const Glyph& g, float x, std::vector<GLfloat>& verts) // new path
{
    const float x0 = x + (float)g.initialDist;
    const float x1 = x0 + (float)(g.endX - g.startX);
    const float y1 = (float)(g.endY - g.startY);
    const float u0 = (float)g.startX / texSize, u1 = (float)g.endX / texSize;
    const float v0 = 1.0f - (float)g.startY / texSize, v1 = 1.0f - (float)g.endY / texSize;
    const GLfloat quad[6][5] =
    {
        { x0, y1, 0.0f, u0, v0 }, { x0, 0.0f, 0.0f, u0, v1 }, { x1, y1, 0.0f, u1, v0 },
        { x1, y1, 0.0f, u1, v0 }, { x0, 0.0f, 0.0f, u0, v1 }, { x1, 0.0f, 0.0f, u1, v1 }
    };
    verts.insert(verts.end(), &quad[0][0], &quad[0][0] + 30);
}

static const char* text = "0120312 2103 0012";

static void drawStringOld(float scale)
{
    glPushMatrix();
    glScalef(scale, scale, 1);
    for (const char* c = text; *c; c++)
    {
        const Glyph& g = glyphs[*c - '0'];
        if (*c == '3' || *c == ' ')
            glTranslatef((float)glyphs[3].fullWidth, 0, 0);
        else
            renderGlyph(g);
    }
    glPopMatrix();
}

static void drawStringNew(float scale)
{
    static std::vector<GLfloat> verts;
    verts.clear();
    float x = 0;
    glPushMatrix();
    glScalef(scale, scale, 1);
    for (const char* c = text; *c; c++)
    {
        const int i = (*c == ' ') ? 3 : *c - '0';
        if (i != 3)
            appendGlyph(glyphs[i], x, verts);
        x += (float)glyphs[i].fullWidth;
    }
    const GLsizei stride = 5 * sizeof(GLfloat);
    glEnableClientState(GL_TEXTURE_COORD_ARRAY);
    glVertexPointer(3, GL_FLOAT, stride, &verts[0]);
    glTexCoordPointer(2, GL_FLOAT, stride, &verts[3]);
    glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(verts.size() / 5));
    glDisableClientState(GL_TEXTURE_COORD_ARRAY);
    glPopMatrix();
}

static void testFonts()
{
    glColor4f(1, 0.8f, 0.6f, 1);
    textured(true);
    auto lines = [](void (*fn)(float))
    {
        for (int row = 0; row < 6; row++)
        {
            glPushMatrix();
            glTranslatef(4, 8 + row * 40.0f, 0);
            fn(1.0f + row * 0.15f);
            glPopMatrix();
        }
    };
    Image ref = render([&] { lines(drawStringOld); });
    Image got = render([&] { lines(drawStringNew); });
    check("fonts: one batched draw per string == per-glyph strips", ref, got);

    // the batched string must not disturb a following immediate draw
    const std::vector<Prim> prims = tankLikePrims();
    ref = render([&] { for (const Prim& p : prims) drawImmediate(p, p.mode); });
    got = render([&]
    {
        lines(drawStringNew);
        glClear(GL_COLOR_BUFFER_BIT);
        for (const Prim& p : prims) drawImmediate(p, p.mode);
    });
    check("immediate mode after batched strings is unaffected", ref, got);
}

// Reproduce the old bug (informational, not counted): draw from separate
// vertex/texcoord arrays, change the texcoords in place, then draw again
// setting only glVertexPointer while the texcoord array stays enabled, as
// the old code did. Real GL reads the new texcoords; the emulation had
// replaced the saved texcoord pointer with its own re-strided copy.
static void demoOldBug()
{
    const std::vector<Prim> prims = tankLikePrims();
    std::vector<GLfloat> pos, tex;
    for (const Prim& p : prims)
    {
        std::vector<int> corners;
        triangulatePrimitive(p.mode, p.count(), corners);
        for (int c : corners)
        {
            const GLfloat* a = &p.v[c * 8];
            pos.insert(pos.end(), { a[0], a[1], 0 });
            tex.insert(tex.end(), { a[6], a[7] });
        }
    }
    std::vector<GLfloat> tex2(tex.size());
    for (size_t i = 0; i < tex.size(); i++)
        tex2[i] = tex[i] * 0.5f + 0.25f;
    const GLsizei n = (GLsizei)(pos.size() / 3);
    glColor4f(1, 1, 1, 1);
    textured(true);
    Image ref = render([&]
    {
        glEnableClientState(GL_TEXTURE_COORD_ARRAY);
        glVertexPointer(3, GL_FLOAT, 0, pos.data());
        glTexCoordPointer(2, GL_FLOAT, 0, tex2.data());
        glDrawArrays(GL_TRIANGLES, 0, n);
        glDisableClientState(GL_TEXTURE_COORD_ARRAY);
    });
    std::vector<GLfloat> live = tex;
    Image got = render([&]
    {
        glEnableClientState(GL_TEXTURE_COORD_ARRAY);
        glVertexPointer(3, GL_FLOAT, 0, pos.data());
        glTexCoordPointer(2, GL_FLOAT, 0, live.data());
        glDrawArrays(GL_TRIANGLES, 0, n);
        glClear(GL_COLOR_BUFFER_BIT);
        live = tex2;                                  // same array, new data
        glVertexPointer(3, GL_FLOAT, 0, pos.data());  // only this is re-set
        glDrawArrays(GL_TRIANGLES, 0, n);
        glDisableClientState(GL_TEXTURE_COORD_ARRAY);
    });
    const int d = diffPixels(ref, got);
    printf("INFO old separate arrays, redraw with only glVertexPointer: %d pixels wrong%s\n",
           d, d ? " (bug reproduced)" : "");
}

static double timeFrames(const std::function<void()>& frame, int frames)
{
    unsigned char px[4];
    glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
    const double t0 = emscripten_get_now();
    for (int f = 0; f < frames; f++)
    {
        glClear(GL_COLOR_BUFFER_BIT);
        frame();
        glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
    }
    return (emscripten_get_now() - t0) / frames;
}

static void benchmarks()
{
    printf("--- timings (ms per frame, headless software GL: compare ratios only)\n");
    textured(true);
    glColor4f(1, 1, 1, 1);
    // HUD-sized text: 60 strings of ~17 characters
    auto hud = [](void (*fn)(float))
    {
        for (int row = 0; row < 60; row++)
        {
            glPushMatrix();
            glTranslatef(2, (float)(row * 4), 0);
            fn(0.5f);
            glPopMatrix();
        }
    };
    const double fOld = timeFrames([&] { hud(drawStringOld); }, 30);
    const double fNew = timeFrames([&] { hud(drawStringNew); }, 30);
    printf("TIME fonts, 60 strings: per-glyph %.2f ms, batched %.2f ms (%.1fx)\n",
           fOld, fNew, fOld / fNew);

    // background-sized scene: 13 small primitives of ~10-40 vertices
    std::vector<Prim> bg;
    for (int k = 0; k < 13; k++)
    {
        Prim p = { GL_TRIANGLE_STRIP, {} };
        for (int i = 0; i < 12; i++)
        {
            p.add(5 + i * 20.0f, 5 + k * 19.0f, i / 11.0f, 0);
            p.add(5 + i * 20.0f + 3, 20 + k * 19.0f, i / 11.0f, 1);
        }
        bg.push_back(p);
    }
    std::vector<OpenGLVertexBuffer> bufs(bg.size());
    for (size_t k = 0; k < bg.size(); k++)
        fillBuffer(bufs[k], std::vector<Prim>(1, bg[k]));
    const double bOld = timeFrames([&] { for (const Prim& p : bg) drawImmediate(p, p.mode); }, 60);
    const double bNew = timeFrames([&]
    {
        for (auto& b : bufs)
        {
            b.bind(false, true);
            glDrawArrays(GL_TRIANGLES, 0, b.getCount());
            OpenGLVertexBuffer::unbind();
        }
    }, 60);
    printf("TIME background, 13 small draws: immediate %.2f ms, VBO %.2f ms (%.1fx)\n",
           bOld, bNew, bOld / bNew);
}

int main(int argc, char** argv)
{
    glutInit(&argc, argv);
    glutInitWindowSize(W, H);
    glutInitDisplayMode(GLUT_RGBA | GLUT_DEPTH);
    glutCreateWindow("gltest");
    glEnableClientState(GL_VERTEX_ARRAY);   // the port's default state
    setup2D();
    makeChecker();

    testTankParts();
    testMeshIndexed();
    testFonts();
    demoOldBug();
    benchmarks();

    printf("DONE failures=%d\n", failures);
    return 0;
}
