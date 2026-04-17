set(GLKIT_SOURCES
    OpenGLFramebuffer.cxx
    OpenGLGState.cxx
    OpenGLLight.cxx
    OpenGLMaterial.cxx
    OpenGLTexture.cxx
    OpenGLUtils.cxx
    RenderNode.cxx
)

if(EMSCRIPTEN)
    list(APPEND GLKIT_SOURCES EmscriptenStubs.cxx)
endif()

add_library(BZFlag_GLKit STATIC ${GLKIT_SOURCES})

target_include_directories(BZFlag_GLKit PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

if(NOT EMSCRIPTEN)
    target_link_libraries(BZFlag_GLKit PUBLIC OpenGL::GL OpenGL::GLU GLEW::GLEW)
endif()
