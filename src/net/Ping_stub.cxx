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

// Emscripten-only no-op stub for PingPacket.
// The real implementation (Ping.cxx) depends on UDP broadcast sockets which
// browsers do not expose. LAN discovery is disabled under Emscripten; server
// list is fetched via HTTPS. These stubs let the link succeed.
// See docs/PORT_PROGRESS.md "Top remaining Emscripten issues".

#ifdef __EMSCRIPTEN__

#include "Ping.h"
#include "Protocol.h"
#include <cstring>

const int PingPacket::PacketSize = ServerIdPLen + 52;

PingPacket::PingPacket() : gameOptions(0), gameType(TeamFFA),
    maxShots(1),
    shakeWins(0),
    shakeTimeout(0),
    maxPlayerScore(0),
    maxTeamScore(0),
    maxTime(0),
    maxPlayers(1),
    rogueCount(0),
    rogueMax(1),
    redCount(0),
    redMax(1),
    greenCount(0),
    greenMax(1),
    blueCount(0),
    blueMax(1),
    purpleCount(0),
    purpleMax(1),
    observerCount(0),
    observerMax(1)
{
}

PingPacket::~PingPacket() {}

bool PingPacket::read(int, struct sockaddr_in*) { return false; }
bool PingPacket::write(int, const struct sockaddr_in*) const { return false; }
bool PingPacket::waitForReply(int, const Address&, int) { return false; }

void* PingPacket::pack(void* buf, const char*) const { return buf; }
const void* PingPacket::unpack(const void* buf, char*) { return buf; }

void PingPacket::packHex(char*) const {}
void PingPacket::unpackHex(char*)
{
    // NOTE: no-op; real impl in Phase 1.5
}

void PingPacket::zeroPlayerCounts()
{
    rogueCount = redCount = greenCount = blueCount = purpleCount = observerCount = 0;
}

void PingPacket::writeToFile(std::ostream&) const
{
    // NOTE: no-op; real impl in Phase 1.5
}

bool PingPacket::readFromFile(std::istream&)
{
    // NOTE: no-op; real impl in Phase 1.5
    return false;
}

void PingPacket::repackHexPlayerCounts(char*, int*) {}

bool PingPacket::isRequest(int, struct sockaddr_in*) { return false; }
bool PingPacket::sendRequest(int, const struct sockaddr_in*) { return false; }

int PingPacket::hex2bin(char) { return 0; }
char PingPacket::bin2hex(int) { return '0'; }
char* PingPacket::packHex16(char* buf, uint16_t) { return buf; }
char* PingPacket::unpackHex16(char* buf, uint16_t& v) { v = 0; return buf; }
char* PingPacket::packHex8(char* buf, uint8_t) { return buf; }
char* PingPacket::unpackHex8(char* buf, uint8_t& v) { v = 0; return buf; }

#endif // __EMSCRIPTEN__
