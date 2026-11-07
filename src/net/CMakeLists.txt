set(NET_SOURCES
    Address.cxx
    Pack.cxx
    network.cxx
)

if(NOT EMSCRIPTEN)
    list(APPEND NET_SOURCES
        AresHandler.cxx
        Ping.cxx
        multicast.cxx
    )
else()
    list(APPEND NET_SOURCES
        AresHandler_stub.cxx
        Ping_stub.cxx
        multicast_stub.cxx
    )
endif()

add_library(BZFlag_Net STATIC
    ${NET_SOURCES}
)

target_include_directories(BZFlag_Net PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

if(NOT EMSCRIPTEN)
    target_link_libraries(BZFlag_Net PUBLIC ${CARES_LIBRARY})
    target_include_directories(BZFlag_Net PUBLIC ${CARES_INCLUDE_DIR})
endif()
