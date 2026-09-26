if(EMSCRIPTEN OR NOT ENABLE_BZADMIN)
    return()
endif()

add_executable(bzadmin
    BZAdminClient.cxx
    BZAdminUI.cxx
    OptionParser.cxx
    ServerLink.cxx
    StdBothUI.cxx
    StdInUI.cxx
    StdOutUI.cxx
    UIMap.cxx
    bzadmin.cxx
)

if(CURSES_FOUND)
    target_sources(bzadmin PRIVATE
        CursesUI.cxx
        CursesMenu.cxx
    )
    target_compile_definitions(bzadmin PRIVATE HAVE_CURSES)
    target_link_libraries(bzadmin PRIVATE ${CURSES_LIBRARIES})
endif()

target_include_directories(bzadmin PRIVATE
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
)

target_link_libraries(bzadmin PRIVATE
    BZFlag_Date
    BZFlag_Game
    BZFlag_Net
    BZFlag_Common
    CURL::libcurl
    ${CARES_LIBRARY}
)

if(REGEX_LIBRARY)
    target_link_libraries(bzadmin PRIVATE ${REGEX_LIBRARY})
endif()
