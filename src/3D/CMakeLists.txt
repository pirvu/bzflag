add_library(BZFlag_3D STATIC
    FontManager.cxx
    ImageFont.cxx
    TextureFont.cxx
    TextureManager.cxx
)

target_include_directories(BZFlag_3D PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)
