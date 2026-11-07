add_library(BZFlag_Game STATIC
    BzMaterial.cxx
    CacheManager.cxx
    CollisionManager.cxx
    CommandsStandard.cxx
    DirectoryNames.cxx
    DynamicColor.cxx
    Frustum.cxx
    Intersect.cxx
    LagInfo.cxx
    LinkManager.cxx
    MsgStrings.cxx
    MeshTransform.cxx
    NetHandler.cxx
    PhysicsDriver.cxx
    PlayerInfo.cxx
    Ray.cxx
    ServerItem.cxx
    ServerAuth.cxx
    ServerList.cxx
    ServerListCache.cxx
    StartupInfo.cxx
    TextureMatrix.cxx
)

target_include_directories(BZFlag_Game PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

target_link_libraries(BZFlag_Game PUBLIC
    BZFlag_Common
    BZFlag_Net
)
