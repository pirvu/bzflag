# EmscriptenConfig.cmake
# Global Emscripten settings for BZFlag WebAssembly build

message(STATUS "Configuring for Emscripten/WebAssembly build")

# Emscripten provides SDL2 and zlib as ports
add_compile_options(-sUSE_SDL=2 -sUSE_ZLIB=1)
add_link_options(-sUSE_SDL=2 -sUSE_ZLIB=1)

# Server and bzadmin are not supported under Emscripten
set(ENABLE_SERVER OFF CACHE BOOL "Server disabled for Emscripten" FORCE)
set(ENABLE_BZADMIN OFF CACHE BOOL "bzadmin disabled for Emscripten" FORCE)
set(ENABLE_PLUGINS OFF CACHE BOOL "Plugins disabled for Emscripten" FORCE)

# Global compile definition
add_compile_definitions(EMSCRIPTEN_BUILD)

# Emscripten provides these, so set found flags
set(SDL2_FOUND TRUE)
set(ZLIB_FOUND TRUE)
set(OPENGL_FOUND TRUE)
set(GLEW_FOUND TRUE)
set(CURL_FOUND TRUE)

# c-ares is not used under Emscripten (we use emscripten_fetch or JS networking)
set(CARES_LIBRARY "")
set(CARES_INCLUDE_DIR "")
