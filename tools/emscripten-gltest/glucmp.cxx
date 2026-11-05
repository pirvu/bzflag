// Compare QuadricGeometry with the system libGLU: the GL calls libGLU
// makes are captured by defining them here (the executable's symbols take
// precedence, link with -rdynamic), then compared primitive by primitive.
// Run with tools/emscripten-gltest/run.sh.
#include <cstdio>
#include <cmath>
#include <string>
#include "QuadricGeometry.h"

static QuadricPrimitives captured;
extern "C" {
void glBegin(GLenum m) { captured.begin(m); }
void glEnd() { captured.end(); }
void glNormal3f(GLfloat x, GLfloat y, GLfloat z) { captured.normal(x, y, z); }
void glTexCoord2f(GLfloat s, GLfloat t) { captured.texCoord(s, t); }
void glVertex3f(GLfloat x, GLfloat y, GLfloat z) { captured.vertex(x, y, z); }
}

static int failures = 0;

static void compare(const std::string& name, const QuadricPrimitives& ref, const QuadricPrimitives& got)
{
    std::string why;
    float maxErr = 0;
    size_t verts = 0;
    if (ref.primitives.size() != got.primitives.size())
        why = "primitive count " + std::to_string(ref.primitives.size()) + " vs " + std::to_string(got.primitives.size());
    for (size_t p = 0; why.empty() && p < ref.primitives.size(); p++)
    {
        const auto& a = ref.primitives[p];
        const auto& b = got.primitives[p];
        if (a.mode != b.mode) { why = "mode of primitive " + std::to_string(p); break; }
        if (a.vertices.size() != b.vertices.size()) { why = "vertex count of primitive " + std::to_string(p); break; }
        verts += a.vertices.size() / 8;
        for (size_t k = 0; k < a.vertices.size(); k++)
            maxErr = std::fmax(maxErr, std::fabs(a.vertices[k] - b.vertices[k]));
    }
    if (why.empty() && maxErr > 1e-5f)
        why = "max difference " + std::to_string(maxErr);
    printf("%s %-46s prims=%3zu verts=%5zu maxErr=%.2g %s\n", why.empty() ? "PASS" : "FAIL",
           name.c_str(), ref.primitives.size(), verts, maxErr, why.c_str());
    if (!why.empty())
        failures++;
}

int main()
{
    const GLenum normals[] = { GLU_SMOOTH, GLU_NONE };
    const GLenum orients[] = { GLU_OUTSIDE, GLU_INSIDE };
    for (GLenum n : normals)
        for (GLenum o : orients)
            for (int tex = 0; tex < 2; tex++)
            {
                QuadricStyle style;
                style.normals = n;
                style.orientation = o;
                style.texture = tex;
                GLUquadric* q = gluNewQuadric();
                gluQuadricNormals(q, n);
                gluQuadricOrientation(q, o);
                gluQuadricTexture(q, tex ? GL_TRUE : GL_FALSE);
                char tag[64];
                snprintf(tag, sizeof(tag), "[%s %s %s]", n == GLU_SMOOTH ? "smooth" : "none",
                         o == GLU_OUTSIDE ? "out" : "in", tex ? "tex" : "notex");

                // the calls BZFlag makes, plus a few more
                struct { int slices, stacks; } spheres[] = { {32, 32}, {16, 16}, {12, 12}, {8, 8}, {6, 6}, {4, 4}, {7, 3}, {9, 5} };
                // (no stacks > slices: libGLU then reads an uninitialized
                // slice cache entry for the bottom apex normal)
                for (auto s : spheres)
                {
                    captured = QuadricPrimitives();
                    gluSphere(q, 0.5, s.slices, s.stacks);
                    QuadricPrimitives mine;
                    quadricSphere(style, 0.5, s.slices, s.stacks, mine);
                    compare(std::string("sphere ") + std::to_string(s.slices) + "x" + std::to_string(s.stacks) + " " + tag, captured, mine);
                }
                struct { double b, t, h; int sl, st; } cyls[] = { {0.0625, 0.0625, 300, 10, 1}, {0.4, 0.4, 300, 32, 1}, {0, 0.43589, 0.1, 8, 1}, {0.43589, 0, 0.1, 8, 1}, {1, 0.5, 2, 12, 3} };
                for (auto c : cyls)
                {
                    captured = QuadricPrimitives();
                    gluCylinder(q, c.b, c.t, c.h, c.sl, c.st);
                    QuadricPrimitives mine;
                    quadricCylinder(style, c.b, c.t, c.h, c.sl, c.st, mine);
                    char nm[160];
                    snprintf(nm, sizeof(nm), "cylinder %.3g/%.3g/%.3g %dx%d %s", c.b, c.t, c.h, c.sl, c.st, tag);
                    compare(nm, captured, mine);
                }
                struct { double in, out; int sl, lo; double start, sweep; } disks[] = { {0, 0.2, 8, 1, 0, 360}, {0.1, 0.5, 16, 3, 0, 360}, {0, 1, 12, 2, 30, 120}, {0.2, 1, 6, 1, 90, -200} };
                for (auto d : disks)
                {
                    captured = QuadricPrimitives();
                    gluPartialDisk(q, d.in, d.out, d.sl, d.lo, d.start, d.sweep);
                    QuadricPrimitives mine;
                    quadricPartialDisk(style, d.in, d.out, d.sl, d.lo, d.start, d.sweep, mine);
                    char nm[160];
                    snprintf(nm, sizeof(nm), "disk %.2g-%.2g %dx%d %g+%g %s", d.in, d.out, d.sl, d.lo, d.start, d.sweep, tag);
                    compare(nm, captured, mine);
                }
                gluDeleteQuadric(q);
            }
    printf("DONE failures=%d\n", failures);
    return failures != 0;
}
