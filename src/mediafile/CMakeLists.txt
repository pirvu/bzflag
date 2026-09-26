add_library(BZFlag_MediaFile STATIC
    ImageFile.cxx
    MediaFile.cxx
    PNGImageFile.cxx
    SGIImageFile.cxx
    AudioFile.cxx
    WaveAudioFile.cxx
)

target_include_directories(BZFlag_MediaFile PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

target_compile_definitions(BZFlag_MediaFile PRIVATE
    INSTALL_DATA_DIR="${BZFLAG_DATADIR}"
)

if(NOT EMSCRIPTEN)
    target_link_libraries(BZFlag_MediaFile PUBLIC ZLIB::ZLIB)
endif()
# For Emscripten, zlib comes in via -sUSE_ZLIB=1 (EmscriptenConfig.cmake).
