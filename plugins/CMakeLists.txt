# plugins/CMakeLists.txt - server plugins built with CMake
#
# Only the plugins the CMake builds use are listed here; the autotools build
# (plugins/Makefile.am) still builds all of them.

add_library(plugin_utils STATIC
    plugin_utils/plugin_utils.cpp
    plugin_utils/plugin_files.cpp
    plugin_utils/plugin_groups.cpp
    plugin_utils/plugin_config.cpp
)
set_target_properties(plugin_utils PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(plugin_utils PUBLIC
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/plugin_utils
)

# Plugins are loaded by name (e.g. -loadplugin webStats), so no "lib" prefix
function(bzflag_plugin name)
    add_library(${name} MODULE ${ARGN})
    target_link_libraries(${name} PRIVATE plugin_utils)
    set_target_properties(${name} PROPERTIES PREFIX "")
    install(TARGETS ${name} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}/bzflag)
endfunction()

bzflag_plugin(webStats webStats/webStats.cpp)
