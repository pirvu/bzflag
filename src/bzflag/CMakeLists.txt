if(NOT ENABLE_CLIENT)
    return()
endif()

add_executable(bzflag
    ActionBinding.cxx
    AutoPilot.cxx
    BackgroundRenderer.cxx
    BaseLocalPlayer.cxx
    CacheMenu.cxx
    clientConfig.cxx
    CommandsImplementation.cxx
    ComposeDefaultKey.cxx
    ControlPanel.cxx
    defaultBZDB.cxx
    DisplayMenu.cxx
    Downloads.cxx
    EffectsMenu.cxx
    effectsRenderer.cxx
    EntryZone.cxx
    FlashClock.cxx
    ForceFeedback.cxx
    FormatMenu.cxx
    GuidedMissleStrategy.cxx
    GUIOptionsMenu.cxx
    HelpMenu.cxx
    HUDDialog.cxx
    HUDDialogStack.cxx
    HUDRenderer.cxx
    HUDui.cxx
    HUDuiControl.cxx
    HUDuiDefaultKey.cxx
    HUDuiJSTestLabel.cxx
    HUDuiLabel.cxx
    HUDuiList.cxx
    HUDuiTextureLabel.cxx
    HUDuiTypeIn.cxx
    JoystickTestMenu.cxx
    JoinMenu.cxx
    InputMenu.cxx
    KeyboardMapMenu.cxx
    LocalCommand.cxx
    LocalPlayer.cxx
    MainMenu.cxx
    MainWindow.cxx
    MenuDefaultKey.cxx
    motd.cxx
    NewVersionMenu.cxx
    OptionsMenu.cxx
    Player.cxx
    Plan.cxx
    QuickKeysMenu.cxx
    QuitMenu.cxx
    RadarRenderer.cxx
    Region.cxx
    RegionPriorityQueue.cxx
    RemotePlayer.cxx
    Roaming.cxx
    RobotPlayer.cxx
    RoofTops.cxx
    Roster.cxx
    SaveWorldMenu.cxx
    SceneBuilder.cxx
    SceneRenderer.cxx
    ScoreboardRenderer.cxx
    SegmentedShotStrategy.cxx
    ServerCommandKey.cxx
    ServerLink.cxx
    ServerListFilter.cxx
    ServerListFilterHelpMenu.cxx
    ServerListFilterMenu.cxx
    ServerMenu.cxx
    ServerStartMenu.cxx
    ShockWaveStrategy.cxx
    ShotPath.cxx
    ShotPathSegment.cxx
    ShotStats.cxx
    ShotStatsDefaultKey.cxx
    ShotStatistics.cxx
    ShotStrategy.cxx
    SilenceDefaultKey.cxx
    TargetingUtils.cxx
    TrackMarks.cxx
    Weapon.cxx
    WeatherRenderer.cxx
    World.cxx
    WorldBuilder.cxx
    WorldPlayer.cxx
    bzflag.cxx
    callbacks.cxx
    clientCommands.cxx
    daylight.cxx
    playing.cxx
    sound.cxx
    stars.cxx
)

target_include_directories(bzflag PRIVATE
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
    ${CMAKE_SOURCE_DIR}/src/platform
)

target_compile_definitions(bzflag PRIVATE
    INSTALL_DATA_DIR="${BZFLAG_DATADIR}"
)

target_link_libraries(bzflag PRIVATE
    BZFlag_3D
    BZFlag_Game
    BZFlag_Net
    BZFlag_Obstacle
    BZFlag_Platform
    BZFlag_GLKit
    BZFlag_SceneDB
    BZFlag_Geometry
    BZFlag_MediaFile
    BZFlag_Common
    BZFlag_Date
)

if(EMSCRIPTEN)
    target_link_options(bzflag PRIVATE
        "SHELL:-s USE_SDL=2"
        "SHELL:-s USE_ZLIB=1"
        "SHELL:-s LEGACY_GL_EMULATION=1"
        "SHELL:-s GL_UNSAFE_OPTS=0"
        "SHELL:-s ASSERTIONS=0"
        "SHELL:-s MIN_WEBGL_VERSION=1"
        "SHELL:-s MAX_WEBGL_VERSION=2"
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        "SHELL:-s INITIAL_MEMORY=134217728"
        "SHELL:-s ASYNCIFY"
        "SHELL:-s ASYNCIFY_STACK_SIZE=65536"
        "SHELL:-s FETCH=1"
        "SHELL:-s WEBSOCKET_URL=\"ws://\""
        "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/data@/data"
        "SHELL:--shell-file ${CMAKE_SOURCE_DIR}/web/shell.html"
    )
    set_target_properties(bzflag PROPERTIES SUFFIX ".html")
else()
    target_link_libraries(bzflag PRIVATE
        SDL2::SDL2
        OpenGL::GL
        OpenGL::GLU
        GLEW::GLEW
        ZLIB::ZLIB
        CURL::libcurl
        Threads::Threads
        ${CARES_LIBRARY}
    )
    if(REGEX_LIBRARY)
        target_link_libraries(bzflag PRIVATE ${REGEX_LIBRARY})
    endif()
    if(MATH_LIBRARY)
        target_link_libraries(bzflag PRIVATE ${MATH_LIBRARY})
    endif()
endif()
