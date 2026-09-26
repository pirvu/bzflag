if(EMSCRIPTEN OR NOT ENABLE_SERVER)
    return()
endif()

add_executable(bzfs
    AccessControlList.cxx
    Authentication.cxx
    BanCommands.cxx
    base64.cxx
    bzfsAPI.cxx
    bzfsHTTPAPI.cxx
    BZWError.cxx
    BZWReader.cxx
    CmdLineOptions.cxx
    CustomArc.cxx
    CustomBase.cxx
    CustomBox.cxx
    CustomCone.cxx
    CustomDynamicColor.cxx
    CustomGate.cxx
    CustomGroup.cxx
    CustomLink.cxx
    CustomMaterial.cxx
    CustomMesh.cxx
    CustomMeshFace.cxx
    CustomMeshTransform.cxx
    CustomPhysicsDriver.cxx
    CustomSphere.cxx
    CustomTextureMatrix.cxx
    CustomPyramid.cxx
    CustomTetra.cxx
    CustomWaterLevel.cxx
    CustomWeapon.cxx
    CustomWorld.cxx
    CustomZone.cxx
    DropGeometry.cxx
    EntryZones.cxx
    Filter.cxx
    FlagHistory.cxx
    FlagInfo.cxx
    GameKeeper.cxx
    ListServerConnection.cxx
    MasterBanList.cxx
    ParseMaterial.cxx
    Permissions.cxx
    RandomSpawnPolicy.cxx
    RecordReplay.cxx
    RejoinList.cxx
    Score.cxx
    ServerCommand.cxx
    ServerSidePlayer.cxx
    ShotManager.cxx
    SpawnPolicy.cxx
    SpawnPosition.cxx
    TeamBases.cxx
    VotingArbiter.cxx
    WorldFileLocation.cxx
    WorldFileObject.cxx
    WorldFileObstacle.cxx
    WorldGenerators.cxx
    WorldInfo.cxx
    WorldWeapons.cxx
    WorldEventManager.cxx
    commands.cxx
    bzfs.cxx
)

if(ENABLE_PLUGINS)
    target_sources(bzfs PRIVATE bzfsPlugins.cxx)
endif()

target_include_directories(bzfs PRIVATE
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

target_compile_definitions(bzfs PRIVATE
    INSTALL_LIB_DIR="${BZFLAG_LIBDIR}"
)

target_link_libraries(bzfs PRIVATE
    BZFlag_Obstacle
    BZFlag_Game
    BZFlag_Net
    BZFlag_Common
    BZFlag_Date
    CURL::libcurl
    ZLIB::ZLIB
    ${CARES_LIBRARY}
)

if(REGEX_LIBRARY)
    target_link_libraries(bzfs PRIVATE ${REGEX_LIBRARY})
endif()

if(MATH_LIBRARY)
    target_link_libraries(bzfs PRIVATE ${MATH_LIBRARY})
endif()

if(DL_LIBRARY)
    target_link_libraries(bzfs PRIVATE ${DL_LIBRARY})
endif()
