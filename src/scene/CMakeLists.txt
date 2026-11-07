add_library(BZFlag_SceneDB STATIC
    Occluder.cxx
    Octree.cxx
    SceneDatabase.cxx
    ZSceneDatabase.cxx
    BSPSceneDatabase.cxx
)

target_include_directories(BZFlag_SceneDB PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)
