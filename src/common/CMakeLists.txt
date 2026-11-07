set(COMMON_SOURCES
    AccessList.cxx
    AutoCompleter.cxx
    BzPNG.cxx
    BZDBCache.cxx
    BZDBLocal.cxx
    Bundle.cxx
    BundleMgr.cxx
    CommandManager.cxx
    ConfigFileManager.cxx
    Country.cxx
    ErrorHandler.cxx
    FileManager.cxx
    Flag.cxx
    GameTime.cxx
    KeyManager.cxx
    Language.cxx
    OSFile.cxx
    ParseColor.cxx
    PlayerState.cxx
    ShotUpdate.cxx
    StateDatabase.cxx
    Team.cxx
    TextChunkManager.cxx
    TextUtils.cxx
    TimeKeeper.cxx
    VotingBooth.cxx
    WordFilter.cxx
    bz_Locale.cxx
    bzfio.cxx
    bzglob.cxx
    bzsignal.cxx
    global.cxx
    mathRoutine.cxx
    md5.cxx
    messages.cxx
)

if(NOT EMSCRIPTEN)
    list(APPEND COMMON_SOURCES cURLManager.cxx)
else()
    # Stub for link under Emscripten; real networking ported later (emscripten_fetch).
    list(APPEND COMMON_SOURCES cURLManager_stub.cxx)
endif()

add_library(BZFlag_Common STATIC ${COMMON_SOURCES})

target_include_directories(BZFlag_Common PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

target_compile_definitions(BZFlag_Common PRIVATE
    INSTALL_DATA_DIR="${BZFLAG_DATADIR}"
)

if(NOT EMSCRIPTEN)
    target_link_libraries(BZFlag_Common PUBLIC CURL::libcurl)
    target_link_libraries(BZFlag_Common PUBLIC ZLIB::ZLIB)
endif()
# For Emscripten, zlib comes in via -sUSE_ZLIB=1 at link time (EmscriptenConfig.cmake).
