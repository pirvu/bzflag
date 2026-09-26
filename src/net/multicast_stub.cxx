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

// Emscripten-only no-op stub for broadcast socket helpers.
// Browsers have no UDP broadcast; LAN server discovery is disabled under
// Emscripten. These stubs return failure so the link succeeds.
// See docs/PORT_PROGRESS.md "Top remaining Emscripten issues".

#ifdef __EMSCRIPTEN__

#include "multicast.h"
#include <cstring>

int openBroadcast(int, const char*, struct sockaddr_in* addr)
{
    if (addr)
        memset(addr, 0, sizeof(*addr));
    return -1;
}

int closeBroadcast(int) { return 0; }

int sendBroadcast(int, const void*, int, const struct sockaddr_in*)
{
    return -1;
}

int recvBroadcast(int, void*, int, struct sockaddr_in*)
{
    return -1;
}

#endif // __EMSCRIPTEN__
