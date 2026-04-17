add_library(BZFlag_Platform STATIC
    PlatformFactory.cxx
    BzfDisplay.cxx
    BzfJoystick.cxx
    BzfVisual.cxx
    BzfWindow.cxx
    BzfMedia.cxx
    SDLJoystick.cxx
    SDLPlatformFactory.cxx
    SDLMedia.cxx
    SDL2Display.cxx
    SDL2Visual.cxx
    SDL2Window.cxx
)

if(APPLE)
    target_sources(BZFlag_Platform PRIVATE MacDataPath.cxx)
endif()

target_include_directories(BZFlag_Platform PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_definitions(BZFlag_Platform PRIVATE
    INSTALL_DATA_DIR="${BZFLAG_DATADIR}"
)

if(NOT EMSCRIPTEN)
    target_link_libraries(BZFlag_Platform PUBLIC SDL2::SDL2)
endif()
