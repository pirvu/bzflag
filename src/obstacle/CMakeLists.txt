set(OBSTACLE_SOURCES
    ArcObstacle.cxx
    ConeObstacle.cxx
    SphereObstacle.cxx
    BaseBuilding.cxx
    BoxBuilding.cxx
    MeshFace.cxx
    MeshObstacle.cxx
    Triangulate.cxx
    MeshDrawInfo.cxx
    PyramidBuilding.cxx
    Teleporter.cxx
    TetraBuilding.cxx
    WallObstacle.cxx
    Obstacle.cxx
    ObstacleModifier.cxx
    ObstacleList.cxx
    ObstacleMgr.cxx
)

if(ENABLE_CLIENT)
    list(APPEND OBSTACLE_SOURCES
        BaseSceneNodeGenerator.cxx
        BoxSceneNodeGenerator.cxx
        EmptySceneNodeGenerator.cxx
        ObstacleSceneNodeGenerator.cxx
        PyramidSceneNodeGenerator.cxx
        TeleporterSceneNodeGenerator.cxx
        WallSceneNodeGenerator.cxx
        MeshSceneNodeGenerator.cxx
    )
endif()

add_library(BZFlag_Obstacle STATIC
    ${OBSTACLE_SOURCES}
)

target_include_directories(BZFlag_Obstacle PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

target_link_libraries(BZFlag_Obstacle PUBLIC
    BZFlag_Common
    BZFlag_Game
)
