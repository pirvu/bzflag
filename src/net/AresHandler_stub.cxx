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

// Emscripten-only stub for AresHandler.
// c-ares is unavailable in the browser. This stub resolves hostnames
// using gethostbyname / inet_aton which Emscripten provides.
// See docs/PORT_PROGRESS.md "Top remaining Emscripten issues".

#ifdef __EMSCRIPTEN__

#include "AresHandler.h"
#include <cstring>
#include <netdb.h>
#include <arpa/inet.h>

bool AresHandler::globallyInited = false;

AresHandler::AresHandler(int _index)
    : index(_index), aresChannel(nullptr), status(None), aresFailed(false)
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
    // Reverse DNS not supported in browser
    status = Failed;
}

void AresHandler::queryHost(const char *hostName_)
{
    hostName = hostName_ ? hostName_ : "";
    memset(&hostAddress, 0, sizeof(hostAddress));

    if (hostName.empty())
    {
        status = Failed;
        return;
    }

    // Try as IP address first
    if (inet_aton(hostName.c_str(), &hostAddress))
    {
        status = HbNSucceeded;
        return;
    }

    // Try hostname resolution (Emscripten provides gethostbyname)
    struct hostent *he = gethostbyname(hostName.c_str());
    if (he && he->h_addrtype == AF_INET && he->h_addr_list[0])
    {
        memcpy(&hostAddress, he->h_addr_list[0], sizeof(hostAddress));
        status = HbNSucceeded;
        return;
    }

    status = Failed;
}

const char *AresHandler::getHostname()
{
    return hostName.c_str();
}

AresHandler::ResolutionStatus AresHandler::getHostAddress(struct in_addr *clientAddr)
{
    if (clientAddr)
    {
        if (status == HbNSucceeded)
            memcpy(clientAddr, &hostAddress, sizeof(*clientAddr));
        else
            memset(clientAddr, 0, sizeof(*clientAddr));
    }
    return status;
}

void AresHandler::setFd(fd_set *, fd_set *, int &)
{
    // No async sockets — resolution is synchronous
}

void AresHandler::process(fd_set *, fd_set *)
{
    // No async processing needed
}

void AresHandler::staticCallback(void *, int, int, struct hostent *) {}

void AresHandler::callback(int, struct hostent *) {}

#endif // __EMSCRIPTEN__
