cmake_minimum_required(VERSION 3.16)
project(BZFlag VERSION 2.4.0 LANGUAGES CXX C)

# Require C++11
set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Build options
option(ENABLE_CLIENT "Build game client" ON)
option(ENABLE_SERVER "Build game server" ON)
option(ENABLE_BZADMIN "Build text admin client" ON)
option(ENABLE_PLUGINS "Build server plugins" ON)
option(ENABLE_ROBOTS "Enable robot players" ON)

# Build date
string(TIMESTAMP BUILD_DATE "%Y-%m-%d" UTC)

# Install paths (GNUInstallDirs populates CMAKE_INSTALL_FULL_DATADIR, _LIBDIR, ...)
include(GNUInstallDirs)
set(BZFLAG_DATADIR "${CMAKE_INSTALL_FULL_DATADIR}/bzflag")
set(BZFLAG_LIBDIR "${CMAKE_INSTALL_FULL_LIBDIR}/")

# Include our CMake helpers
list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake")

# Emscripten detection
if(EMSCRIPTEN)
    include(EmscriptenConfig)
else()
    # Native build: find required packages
    find_package(Threads REQUIRED)
    find_package(ZLIB REQUIRED)
    find_package(CURL REQUIRED)
    find_package(OpenGL)
    find_package(GLEW)

    # SDL2 - try config mode first, then module mode
    find_package(SDL2 CONFIG QUIET)
    if(NOT SDL2_FOUND)
        find_package(SDL2)
    endif()

    # c-ares
    find_library(CARES_LIBRARY NAMES cares)
    find_path(CARES_INCLUDE_DIR ares.h)
    if(NOT CARES_LIBRARY OR NOT CARES_INCLUDE_DIR)
        message(FATAL_ERROR "c-ares library not found")
    endif()

    # dl library
    find_library(DL_LIBRARY NAMES dl)

    # rt library (for shm_open)
    find_library(RT_LIBRARY NAMES rt)

    # regex
    include(CheckFunctionExists)
    check_function_exists(regcomp HAVE_REGEX_IN_LIBC)
    if(NOT HAVE_REGEX_IN_LIBC)
        find_library(REGEX_LIBRARY NAMES regex compat)
        if(NOT REGEX_LIBRARY)
            message(FATAL_ERROR "regex library not found")
        endif()
    endif()

    # math library
    find_library(MATH_LIBRARY NAMES m)

    # curses for bzadmin
    if(ENABLE_BZADMIN)
        find_package(Curses QUIET)
    endif()

    # Disable client if GL/SDL2 not available
    if(ENABLE_CLIENT)
        if(NOT OPENGL_FOUND OR NOT GLEW_FOUND OR NOT SDL2_FOUND)
            message(WARNING "OpenGL, GLEW, or SDL2 not found - disabling client build")
            set(ENABLE_CLIENT OFF)
        endif()
    endif()
endif()

# Plugins require server
if(ENABLE_PLUGINS AND NOT ENABLE_SERVER)
    message(WARNING "Plugins require server - disabling plugins")
    set(ENABLE_PLUGINS OFF)
endif()

# Run configure checks (sets HAVE_* variables)
include(ConfigureChecks)

# Robot support
if(ENABLE_ROBOTS)
    set(ROBOT 1)
endif()

# Plugin support
if(ENABLE_PLUGINS)
    set(BZ_PLUGINS 1)
endif()

# Generate config.h
configure_file(
    "${CMAKE_SOURCE_DIR}/include/config.h.in"
    "${CMAKE_BINARY_DIR}/include/config.h"
)

# Global include paths
include_directories(
    "${CMAKE_SOURCE_DIR}/include"
    "${CMAKE_BINARY_DIR}/include"
)

# Subdirectories
add_subdirectory(src)
