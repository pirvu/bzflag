add_library(BZFlag_Date STATIC
    buildDate.cxx
)

target_include_directories(BZFlag_Date PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)
