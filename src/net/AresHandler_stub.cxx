/* bzflag
 * Copyright (c) 1993-2025 Tim Riker
 *
 * This package is free software;  you can redistribute it and/or
 * modify it under the terms of the license found in the file
 * named COPYING that should have accompanied this file.
 *
 * THIS PACKAGE IS PROVIDED ``AS IS'' AND WITHOUT ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, WITHOUT LIMITATION, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
 */

// Emscripten-only no-op stub for AresHandler.
// c-ares is unavailable in the browser. Hostname resolution will be routed
// through the WebSocket proxy in a later phase; these stubs let the link
// succeed. See docs/PORT_PROGRESS.md "Top remaining Emscripten issues".

#ifdef __EMSCRIPTEN__

#include "AresHandler.h"
#include <cstring>

bool AresHandler::globallyInited = false;

AresHandler::AresHandler(int _index)
    : index(_index), aresChannel(nullptr), status(None), aresFailed(true)
{
    memset(&hostAddress, 0, sizeof(hostAddress));
}

AresHandler::~AresHandler() {}

bool AresHandler::globalInit()
{
    globallyInited = true;
    return true;
}

void AresHandler::globalShutdown()
{
    globallyInited = false;
}

void AresHandler::queryHostname(const struct sockaddr *)
{
    // NOTE: no-op; real impl in Phase 1.5
    status = Failed;
}

void AresHandler::queryHost(const char *)
{
    // NOTE: no-op; real impl in Phase 1.5
    status = Failed;
}

const char *AresHandler::getHostname()
{
    return hostName.c_str();
}

AresHandler::ResolutionStatus AresHandler::getHostAddress(struct in_addr *clientAddr)
{
    if (clientAddr)
        memset(clientAddr, 0, sizeof(*clientAddr));
    return Failed;
}

void AresHandler::setFd(fd_set *, fd_set *, int &)
{
    // NOTE: no-op; no sockets to register
}

void AresHandler::process(fd_set *, fd_set *)
{
    // NOTE: no-op
}

void AresHandler::staticCallback(void *, int, int, struct hostent *) {}

void AresHandler::callback(int, struct hostent *) {}

#endif // __EMSCRIPTEN__
