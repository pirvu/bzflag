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

// webStats.cpp : Streams server events as JSON to a web service and/or a
// JSON-lines file, so a web page can show the log history, per player
// statistics, and notify people when somebody opens a game.

#include "bzfsAPI.h"
#include "plugin_utils.h"

#include <chrono>
#include <regex>
#include <cstdio>
#include <set>
#include <sstream>
#include <string>
#include <vector>

class JSONObject
{
public:
    JSONObject& add(const char* key, const std::string &value)
    {
        sep(key);
        quote(value);
        return *this;
    }
    JSONObject& add(const char* key, const char* value)
    {
        return add(key, std::string(value ? value : ""));
    }
    JSONObject& add(const char* key, long long value)
    {
        sep(key);
        out << value;
        return *this;
    }
    JSONObject& add(const char* key, int value)
    {
        return add(key, (long long)value);
    }
    JSONObject& add(const char* key, double value)
    {
        sep(key);
        out << value;
        return *this;
    }
    JSONObject& add(const char* key, bool value)
    {
        sep(key);
        out << (value ? "true" : "false");
        return *this;
    }
    JSONObject& addRaw(const char* key, const std::string &json)
    {
        sep(key);
        out << json;
        return *this;
    }
    std::string str() const
    {
        return "{" + out.str() + "}";
    }

    static std::string escape(const std::string &s)
    {
        std::string r;
        r.reserve(s.size() + 2);
        for (unsigned char c : s)
        {
            switch (c)
            {
            case '"':
                r += "\\\"";
                break;
            case '\\':
                r += "\\\\";
                break;
            case '\n':
                r += "\\n";
                break;
            case '\r':
                r += "\\r";
                break;
            case '\t':
                r += "\\t";
                break;
            default:
                if (c < 0x20)
                {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    r += buf;
                }
                else
                    r += (char)c;
            }
        }
        return r;
    }

private:
    void sep(const char* key)
    {
        if (!first)
            out << ",";
        first = false;
        out << "\"" << key << "\":";
    }
    void quote(const std::string &value)
    {
        out << "\"" << escape(value) << "\"";
    }

    std::ostringstream out;
    bool first = true;
};

class WebStats : public bz_Plugin
{
public:
    virtual const char* Name ()
    {
        return "Web Stats";
    }
    virtual void Init ( const char* config );
    virtual void Cleanup ();
    virtual void Event ( bz_EventData *eventData );

private:
    void loadConfig(const std::string &config);

    JSONObject newEvent(const char* type);
    void emit(const JSONObject &event);
    void flush();

    void addPlayer(JSONObject &obj, const char* prefix, int playerID);
    void addRecord(JSONObject &obj, bz_BasePlayerRecord *record);
    void playerJoined(bz_PlayerJoinPartEventData_V1 *data);
    void playerParted(bz_PlayerJoinPartEventData_V1 *data);
    void chat(const char* type, int from, int to, bz_eTeamType team, const char* message);
    std::string currentPlayers();
    bool scrubLogLine(std::string &line);

    static std::string teamName(bz_eTeamType team);
    static long long nowMillis();

    std::string url;
    std::string key;
    std::string fileName;
    std::string serverName;
    std::string run;
    int logLevel = 1;
    bool sendIP = false;
    bool privateChat = false;
    double flushInterval = 1.0;

    long long seq = 0;
    std::vector<std::string> pending;
    double lastFlush = 0;
    FILE *file = nullptr;

    // non observer players, used to detect when somebody opens a game
    std::set<int> activePlayers;
};

BZ_PLUGIN(WebStats)

void WebStats::loadConfig(const std::string &config)
{
    // Either a bare URL, or an INI file with a [webStats] section
    if (config.compare(0, 7, "http://") == 0 || config.compare(0, 8, "https://") == 0)
    {
        url = config;
        return;
    }
    if (config.empty())
        return;

    PluginConfig ini(config);
    if (ini.errors)
    {
        bz_debugMessagef(0, "webStats: could not read config file %s", config.c_str());
        return;
    }
    const char* section = "webStats";
    url = ini.item(section, "url");
    key = ini.item(section, "key");
    fileName = ini.item(section, "file");
    serverName = ini.item(section, "server");

    std::string value = ini.item(section, "logLevel");
    if (!value.empty())
        logLevel = atoi(value.c_str());
    value = ini.item(section, "flushInterval");
    if (!value.empty())
        flushInterval = atof(value.c_str());
    sendIP = compare_nocase(ini.item(section, "sendIP"), "true") == 0;
    privateChat = compare_nocase(ini.item(section, "privateChat"), "true") == 0;
}

void WebStats::Init ( const char* commandLine )
{
    loadConfig(commandLine ? commandLine : "");

    if (serverName.empty())
    {
        serverName = bz_getPublicAddr().c_str();
        if (serverName.empty())
            serverName = "localhost:" + std::to_string(bz_getPublicPort());
    }
    run = std::to_string(nowMillis());

    if (!fileName.empty())
    {
        file = fopen(fileName.c_str(), "a");
        if (!file)
            bz_debugMessagef(0, "webStats: could not open %s for writing", fileName.c_str());
    }
    if (url.empty() && !file)
        bz_debugMessage(0, "webStats: no url or file configured, events will be dropped");

    Register(bz_ePlayerJoinEvent);
    Register(bz_ePlayerPartEvent);
    Register(bz_ePlayerDieEvent);
    Register(bz_eCaptureEvent);
    Register(bz_eFlagGrabbedEvent);
    Register(bz_eRawChatMessageEvent);
    Register(bz_eServerMsgEvent);
    Register(bz_eGameStartEvent);
    Register(bz_eGameEndEvent);
    Register(bz_ePlayerAuthEvent);
    Register(bz_eLoggingEvent);
    Register(bz_eTickEvent);

    // the plugin may be loaded on a running server
    bz_APIIntList *players = bz_getPlayerIndexList();
    for (unsigned int i = 0; i < players->size(); i++)
    {
        int id = players->get(i);
        if (bz_getPlayerTeam(id) != eObservers)
            activePlayers.insert(id);
    }
    bz_deleteIntList(players);

    JSONObject event = newEvent("server-start");
    event.add("description", bz_getPublicDescription().c_str());
    event.add("port", bz_getPublicPort());
    event.addRaw("players", currentPlayers());
    emit(event);
    flush();
}

void WebStats::Cleanup ()
{
    emit(newEvent("server-stop"));
    flush();
    if (file)
        fclose(file);
    file = nullptr;
    Flush();
}

long long WebStats::nowMillis()
{
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

std::string WebStats::teamName(bz_eTeamType team)
{
    switch (team)
    {
    case eRogueTeam:
        return "rogue";
    case eRedTeam:
        return "red";
    case eGreenTeam:
        return "green";
    case eBlueTeam:
        return "blue";
    case ePurpleTeam:
        return "purple";
    case eRabbitTeam:
        return "rabbit";
    case eHunterTeam:
        return "hunter";
    case eObservers:
        return "observer";
    case eAdministrators:
        return "admin";
    default:
        return "";
    }
}

JSONObject WebStats::newEvent(const char* type)
{
    JSONObject event;
    event.add("server", serverName);
    event.add("run", run);
    event.add("seq", ++seq);
    event.add("t", nowMillis());
    event.add("type", type);
    return event;
}

void WebStats::emit(const JSONObject &event)
{
    std::string json = event.str();
    if (file)
    {
        fprintf(file, "%s\n", json.c_str());
        fflush(file);
    }
    if (!url.empty())
        pending.push_back(json);
}

void WebStats::flush()
{
    lastFlush = bz_getCurrentTime();
    if (pending.empty())
        return;

    std::string body = "{\"key\":\"" + JSONObject::escape(key) + "\",\"events\":[";
    for (size_t i = 0; i < pending.size(); i++)
    {
        if (i)
            body += ",";
        body += pending[i];
    }
    body += "]}";
    pending.clear();

    // fire and forget, the file output is the durable copy
    bz_addURLJob(url.c_str(), NULL, body.c_str());
}

void WebStats::addRecord(JSONObject &obj, bz_BasePlayerRecord *record)
{
    obj.add("pid", record->playerID);
    obj.add("callsign", record->callsign.c_str());
    obj.add("team", teamName(record->team));
    obj.add("bzid", record->verified ? record->bzID.c_str() : "");
}

void WebStats::addPlayer(JSONObject &obj, const char* prefix, int playerID)
{
    std::string p(prefix);
    bz_BasePlayerRecord *record = playerID >= 0 ? bz_getPlayerByIndex(playerID) : NULL;
    obj.add((p + "Pid").c_str(), playerID);
    if (record)
    {
        obj.add((p + "Callsign").c_str(), record->callsign.c_str());
        obj.add((p + "Team").c_str(), teamName(record->team));
        obj.add((p + "Bzid").c_str(), record->verified ? record->bzID.c_str() : "");
        bz_freePlayerRecord(record);
    }
    else
        obj.add((p + "Callsign").c_str(), playerID == BZ_SERVER || playerID == BZ_SERVERPLAYER ? "SERVER" : "");
}

std::string WebStats::currentPlayers()
{
    std::string list = "[";
    bz_APIIntList *players = bz_getPlayerIndexList();
    for (unsigned int i = 0; i < players->size(); i++)
    {
        bz_BasePlayerRecord *record = bz_getPlayerByIndex(players->get(i));
        if (!record)
            continue;
        JSONObject p;
        addRecord(p, record);
        if (list.size() > 1)
            list += ",";
        list += p.str();
        bz_freePlayerRecord(record);
    }
    bz_deleteIntList(players);
    return list + "]";
}

// Keeps what the chat settings keep private out of the log lines too.
// Returns false when the whole line must be dropped.
bool WebStats::scrubLogLine(std::string &line)
{
    if (!privateChat && (line.find("] -> Player ") != std::string::npos
                         || line.find("] -> Admin: ") != std::string::npos))
        return false;
    if (!sendIP)
    {
        static const std::regex ipv4("\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b");
        line = std::regex_replace(line, ipv4, "x.x.x.x");
    }
    return true;
}

void WebStats::playerJoined(bz_PlayerJoinPartEventData_V1 *data)
{
    if (!data->record)
        return;

    bool observer = data->record->team == eObservers;
    if (!observer)
        activePlayers.insert(data->playerID);

    JSONObject event = newEvent("join");
    addRecord(event, data->record);
    if (sendIP)
        event.add("ip", data->record->ipAddress.c_str());
    event.add("version", data->record->clientVersion.c_str());
    event.add("motto", bz_getPlayerMotto(data->playerID));
    event.add("players", (int)activePlayers.size());
    emit(event);

    if (!observer && activePlayers.size() == 1)
    {
        JSONObject open = newEvent("game-open");
        addRecord(open, data->record);
        open.add("description", bz_getPublicDescription().c_str());
        emit(open);
        // do not wait for the next tick, this one should arrive quickly
        flush();
    }
}

void WebStats::playerParted(bz_PlayerJoinPartEventData_V1 *data)
{
    bool wasActive = activePlayers.erase(data->playerID) > 0;

    JSONObject event = newEvent("part");
    if (data->record)
        addRecord(event, data->record);
    else
        event.add("pid", data->playerID);
    event.add("reason", data->reason.c_str());
    event.add("players", (int)activePlayers.size());
    emit(event);

    if (wasActive && activePlayers.empty())
        emit(newEvent("game-empty"));
}

void WebStats::chat(const char* type, int from, int to, bz_eTeamType team, const char* message)
{
    std::string kind;
    if (to == BZ_ALLUSERS && team == eNoTeam)
        kind = "public";
    else if (to == BZ_NULLUSER)
        kind = team == eAdministrators ? "admin" : "team";
    else
        kind = "private";

    if ((kind == "private" || kind == "admin") && !privateChat)
        return;

    JSONObject event = newEvent(type);
    event.add("kind", kind);
    addPlayer(event, "from", from);
    if (kind == "private")
        addPlayer(event, "to", to);
    if (kind == "team")
        event.add("toTeam", teamName(team));
    event.add("message", message);
    emit(event);
}

void WebStats::Event ( bz_EventData *eventData )
{
    switch (eventData->eventType)
    {
    case bz_ePlayerJoinEvent:
        playerJoined((bz_PlayerJoinPartEventData_V1*)eventData);
        break;

    case bz_ePlayerPartEvent:
        playerParted((bz_PlayerJoinPartEventData_V1*)eventData);
        break;

    case bz_ePlayerDieEvent:
    {
        bz_PlayerDieEventData_V1 *data = (bz_PlayerDieEventData_V1*)eventData;
        JSONObject event = newEvent("kill");
        addPlayer(event, "victim", data->playerID);
        addPlayer(event, "killer", data->killerID);
        event.add("flag", data->flagKilledWith.c_str());
        event.add("teamKill", data->killerID != data->playerID && data->killerTeam == data->team
                  && data->team != eRogueTeam && data->team != eNoTeam);
        emit(event);
        break;
    }

    case bz_eCaptureEvent:
    {
        bz_CTFCaptureEventData_V1 *data = (bz_CTFCaptureEventData_V1*)eventData;
        JSONObject event = newEvent("capture");
        addPlayer(event, "player", data->playerCapping);
        event.add("teamCapping", teamName(data->teamCapping));
        event.add("teamCapped", teamName(data->teamCapped));
        emit(event);
        break;
    }

    case bz_eFlagGrabbedEvent:
    {
        bz_FlagGrabbedEventData_V1 *data = (bz_FlagGrabbedEventData_V1*)eventData;
        JSONObject event = newEvent("flag");
        addPlayer(event, "player", data->playerID);
        event.add("flag", data->flagType);
        emit(event);
        break;
    }

    case bz_eRawChatMessageEvent:
    {
        bz_ChatEventData_V1 *data = (bz_ChatEventData_V1*)eventData;
        chat("chat", data->from, data->to, data->team, data->message.c_str());
        break;
    }

    case bz_eServerMsgEvent:
    {
        bz_ServerMsgEventData_V1 *data = (bz_ServerMsgEventData_V1*)eventData;
        chat("chat", BZ_SERVER, data->to, data->team, data->message.c_str());
        break;
    }

    case bz_eGameStartEvent:
    case bz_eGameEndEvent:
    {
        bz_GameStartEndEventData_V1 *data = (bz_GameStartEndEventData_V1*)eventData;
        bool start = eventData->eventType == bz_eGameStartEvent;
        JSONObject event = newEvent(start ? "match-start" : "match-end");
        event.add("duration", data->duration);
        emit(event);
        break;
    }

    case bz_ePlayerAuthEvent:
    {
        bz_PlayerAuthEventData_V1 *data = (bz_PlayerAuthEventData_V1*)eventData;
        JSONObject event = newEvent("auth");
        addPlayer(event, "player", data->playerID);
        emit(event);
        break;
    }

    case bz_eLoggingEvent:
    {
        bz_LoggingEventData_V1 *data = (bz_LoggingEventData_V1*)eventData;
        if (logLevel < 0 || data->level > logLevel)
            break;
        std::string message = data->message.c_str();
        while (!message.empty() && (message.back() == '\n' || message.back() == '\r'))
            message.pop_back();
        if (message.empty() || !scrubLogLine(message))
            break;
        JSONObject event = newEvent("log");
        event.add("level", data->level);
        event.add("message", message);
        emit(event);
        break;
    }

    case bz_eTickEvent:
        if (!pending.empty() && bz_getCurrentTime() - lastFlush >= flushInterval)
            flush();
        break;

    default:
        break;
    }
}

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
