# ConfigureChecks.cmake
# Translates configure.ac checks to CMake equivalents

include(CheckFunctionExists)
include(CheckIncludeFile)
include(CheckIncludeFileCXX)
include(CheckLibraryExists)
include(CheckTypeSize)
include(CheckCXXSourceCompiles)

# ===== Header checks =====
check_include_file_cxx(cmath HAVE_CMATH)
check_include_file_cxx(cstdlib HAVE_CSTDLIB)
check_include_file_cxx(cstdio HAVE_CSTDIO)
check_include_file_cxx(cstring HAVE_CSTRING)

check_include_file("SDL2/SDL.h" HAVE_SDL2_SDL_H)
check_include_file(bstring.h HAVE_BSTRING_H)
check_include_file(dlfcn.h HAVE_DLFCN_H)
check_include_file(fcntl.h HAVE_FCNTL_H)
check_include_file(inttypes.h HAVE_INTTYPES_H)
check_include_file(limits.h HAVE_LIMITS_H)
check_include_file("linux/input.h" HAVE_LINUX_INPUT_H)
check_include_file(process.h HAVE_PROCESS_H)
check_include_file(sched.h HAVE_SCHED_H)
check_include_file(stdint.h HAVE_STDINT_H)
check_include_file("sys/param.h" HAVE_SYS_PARAM_H)
check_include_file("sys/socket.h" HAVE_SYS_SOCKET_H)
check_include_file("sys/types.h" HAVE_SYS_TYPES_H)
check_include_file(netdb.h HAVE_NETDB_H)
check_include_file(unistd.h HAVE_UNISTD_H)
check_include_file(values.h HAVE_VALUES_H)
check_include_file(regex.h HAVE_REGEX_H)
check_include_file(memory.h HAVE_MEMORY_H)
check_include_file(string.h HAVE_STRING_H)
check_include_file(strings.h HAVE_STRINGS_H)
check_include_file("sys/stat.h" HAVE_SYS_STAT_H)

# ===== Function checks =====
check_function_exists(CGLGetCurrentContext HAVE_CGLGETCURRENTCONTEXT)
check_function_exists(Sleep HAVE_SLEEP)
check_function_exists(WaitForSingleObject HAVE_WAITFORSINGLEOBJECT)
check_function_exists(_stricmp HAVE__STRICMP)
check_function_exists(_strnicmp HAVE__STRNICMP)
check_function_exists(_vsnprintf HAVE__VSNPRINTF)
check_function_exists(atexit HAVE_ATEXIT)
check_function_exists(hstrerror HAVE_HSTRERROR)
check_function_exists(sched_setaffinity HAVE_SCHED_SETAFFINITY)
check_function_exists(select HAVE_SELECT)
check_function_exists(snooze HAVE_SNOOZE)
check_function_exists(usleep HAVE_USLEEP)
check_function_exists(vsnprintf HAVE_VSNPRINTF)
check_function_exists(wglGetCurrentContext HAVE_WGLGETCURRENTCONTEXT)

# ===== Math library float function checks =====
if(MATH_LIBRARY)
    set(CMAKE_REQUIRED_LIBRARIES ${MATH_LIBRARY})
endif()

check_function_exists(acosf HAVE_ACOSF)
check_function_exists(asinf HAVE_ASINF)
check_function_exists(atan2f HAVE_ATAN2F)
check_function_exists(atanf HAVE_ATANF)
check_function_exists(cosf HAVE_COSF)
check_function_exists(expf HAVE_EXPF)
check_function_exists(fabsf HAVE_FABSF)
check_function_exists(floorf HAVE_FLOORF)
check_function_exists(fmodf HAVE_FMODF)
check_function_exists(hypotf HAVE_HYPOTF)
check_function_exists(logf HAVE_LOGF)
check_function_exists(log10f HAVE_LOG10F)
check_function_exists(powf HAVE_POWF)
check_function_exists(sinf HAVE_SINF)
check_function_exists(sqrtf HAVE_SQRTF)
check_function_exists(tanf HAVE_TANF)

set(CMAKE_REQUIRED_LIBRARIES)

# ===== Library checks =====
if(DL_LIBRARY)
    check_library_exists(dl dlopen "" HAVE_LIBDL)
endif()

if(MATH_LIBRARY)
    set(HAVE_LIBM 1)
endif()

# Check for ares_getaddrinfo in c-ares
if(CARES_LIBRARY)
    check_library_exists(cares ares_getaddrinfo "" HAVE_ARES_GETADDRINFO)
endif()

# Check for compressBound in zlib
check_library_exists(z compressBound "" HAVE_ZLIB_COMPRESSBOUND)

# Check for shm_open in librt
if(RT_LIBRARY)
    check_library_exists(rt shm_open "" HAVE_LIBRT)
endif()

# ===== Type size checks =====
check_type_size(int SIZEOF_INT)
check_type_size("short int" SIZEOF_SHORT_INT)
check_type_size("long int" SIZEOF_LONG_INT)
check_type_size("long long int" SIZEOF_LONG_LONG_INT)
check_type_size(float SIZEOF_FLOAT)
check_type_size(double SIZEOF_DOUBLE)
check_type_size("long double" SIZEOF_LONG_DOUBLE)

# ===== socklen_t check =====
check_cxx_source_compiles("
#include <sys/types.h>
#include <sys/socket.h>
int main() { socklen_t len = 42; return (int)len; }
" HAVE_SOCKLEN_T)

# ===== pthreads check =====
if(Threads_FOUND AND CMAKE_USE_PTHREADS_INIT)
    set(HAVE_PTHREADS 1)
    set(_REENTRANT 1)
endif()

# ===== std::isnan check =====
check_cxx_source_compiles("
#include <cmath>
int main() { float f = 0.0f; return std::isnan(f) ? 1 : 0; }
" HAVE_STD__ISNAN)

if(NOT HAVE_STD__ISNAN)
    check_cxx_source_compiles("
    #include <cmath>
    #include <math.h>
    int main() { float f = 0.0f; return isnan(f) ? 1 : 0; }
    " HAVE_ISNAN)
endif()

# ===== std::min / std::max / std::count checks =====
check_cxx_source_compiles("
#include <algorithm>
int main() { int i = std::min(0, 1); return i; }
" HAVE_STD__MIN)

check_cxx_source_compiles("
#include <algorithm>
int main() { int i = std::max(0, 1); return i; }
" HAVE_STD__MAX)

check_cxx_source_compiles("
#include <algorithm>
int main() { char a[] = \"test\"; int i = std::count(a, a+4, 't'); return i; }
" HAVE_STD__COUNT)

# ===== Linux force feedback checks =====
if(HAVE_LINUX_INPUT_H)
    check_cxx_source_compiles("
    #include <linux/input.h>
    int main() { struct ff_effect x; x.u.rumble.weak_magnitude = 42; return 0; }
    " HAVE_FF_EFFECT_RUMBLE)

    check_cxx_source_compiles("
    #include <linux/input.h>
    int main() { struct ff_effect x; x.direction = 0x4000; return 0; }
    " HAVE_FF_EFFECT_DIRECTIONAL)
endif()

# ===== curses header check =====
if(CURSES_FOUND)
    check_include_file(ncurses.h HAVE_NCURSES_H)
    if(NOT HAVE_NCURSES_H)
        check_include_file(curses.h HAVE_CURSES_H)
    endif()
endif()

# ===== libcurl feature detection =====
if(CURL_FOUND)
    set(HAVE_LIBCURL 1)
endif()

# ===== Platform-specific defines =====
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    set(HALF_RATE_AUDIO 1)
endif()

# Build OS string
if(EMSCRIPTEN)
    set(BZ_BUILD_OS "emscripten")
elseif(WIN32)
    set(BZ_BUILD_OS "win32")
elseif(APPLE)
    set(BZ_BUILD_OS "darwin")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    set(BZ_BUILD_OS "linux-gnu")
else()
    set(BZ_BUILD_OS "${CMAKE_SYSTEM_NAME}")
endif()
