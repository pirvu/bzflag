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

// Emscripten-only no-op stub for cURLManager.
// The real implementation (cURLManager.cxx) depends on libcurl which is not
// available under Emscripten. Networking will be ported to emscripten_fetch
// in a later phase; until then these stubs let the link succeed.
// See docs/PORT_PROGRESS.md "Top remaining Emscripten issues".

#ifdef __EMSCRIPTEN__

#include "common.h"
#include "cURLManager.h"

bool cURLManager::inited = false;
bool cURLManager::justCalled = false;
char cURLManager::errorBuffer[CURL_ERROR_SIZE] = {0};
CURLM *cURLManager::multiHandle = nullptr;
std::map<CURL*, cURLManager*> cURLManager::cURLMap;

cURLManager::cURLManager() :
    theData(nullptr), theLen(0), easyHandle(nullptr),
    added(false), usedUrl(), interfaceIP(), userAgent(), postData() {}

cURLManager::~cURLManager() {}

void cURLManager::setup() {}

void cURLManager::addHandle() {}
void cURLManager::removeHandle() {}

void cURLManager::setTimeout(long) {}
void cURLManager::setNoBody() {}
void cURLManager::setGetMode() {}
void cURLManager::setPostMode(std::string) {}
void cURLManager::setRequestFileTime(bool) {}
void cURLManager::setURL(const std::string &url) { usedUrl = url; }
void cURLManager::setProgressFunction(curl_xferinfo_callback, const void*) {}
void cURLManager::setTimeCondition(timeCondition, time_t&) {}
void cURLManager::setInterface(const std::string &ip) { interfaceIP = ip; }
void cURLManager::setUserAgent(const std::string &ua) { userAgent = ua; }

void cURLManager::addFormData(const char*, const char*) {}

bool cURLManager::getFileTime(time_t &t) { t = 0; return false; }
bool cURLManager::getFileSize(int &s) { s = 0; return false; }

void cURLManager::collectData(char*, int) {}
void cURLManager::finalization(char*, unsigned int, bool) {}

int  cURLManager::fdset(fd_set&, fd_set&) { return -1; }
bool cURLManager::perform() { return false; }
void cURLManager::performWait() {}

void cURLManager::infoComplete(CURLcode) {}

size_t cURLManager::writeFunction(void*, size_t size, size_t nmemb, void*)
{
    return size * nmemb;
}

ResourceGetter::ResourceGetter() : doingStuff(false) {}
ResourceGetter::~ResourceGetter() {}
void ResourceGetter::addResource(trResourceItem&) {}
void ResourceGetter::flush() {}
void ResourceGetter::finalization(char*, unsigned int, bool) {}
bool ResourceGetter::itemExists(trResourceItem&) { return false; }
void ResourceGetter::getResource() {}

#endif // __EMSCRIPTEN__
