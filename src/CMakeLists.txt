# src/CMakeLists.txt - BZFlag source tree

# Core libraries (always built)
add_subdirectory(common)
add_subdirectory(net)
add_subdirectory(game)
add_subdirectory(date)
add_subdirectory(obstacle)

# Client libraries and executable
if(ENABLE_CLIENT)
    add_subdirectory(3D)
    add_subdirectory(ogl)
    add_subdirectory(scene)
    add_subdirectory(geometry)
    add_subdirectory(platform)
    add_subdirectory(mediafile)
    add_subdirectory(bzflag)
endif()

# Server executable
if(ENABLE_SERVER)
    add_subdirectory(bzfs)
endif()

# Text admin client
if(ENABLE_BZADMIN)
    add_subdirectory(bzadmin)
endif()
