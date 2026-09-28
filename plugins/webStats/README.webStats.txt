BZFlag Server Plugin: webStats
================================================================================

The webStats plugin sends the server's events (joins, parts, kills, captures,
flags, chat, matches and the server log) as JSON to a small web service. The
web service, in the web/ directory, keeps the history in SQLite and serves a
page with:

* the live log and the searchable history
* who is online and the recent games
* per player statistics (kills, deaths, K/D, captures, play time, favorite
  victims, nemesis, flags, hours of activity)
* Chrome / Firefox / Edge push notifications when somebody opens a game, that
  is when the first player (not an observer) joins an empty server

See web/README.md for running the web service.


Loading the plugin
--------------------------------------------------------------------------------

Quick start, with the web service on the same machine:

  -loadplugin webStats,http://127.0.0.1:8080/api/ingest

With a configuration file (see webStats.cfg for all the options):

  -loadplugin webStats,/path/to/webStats.cfg


Events
--------------------------------------------------------------------------------

Every event is a JSON object with server, run (the start time of this bzfs),
seq, t (unix time in milliseconds) and type. The types are:

  server-start, server-stop  the plugin was loaded / unloaded
  join, part                 a player joined / left
  game-open                  the first player joined an empty server
  game-empty                 the last player left
  kill                       victim*, killer*, flag, teamKill
  capture                    player*, teamCapped, teamCapping
  flag                       player*, flag (a flag was grabbed)
  chat                       kind (public, team, admin, private), from*, message
  auth                       a player identified
  match-start, match-end     a timed match started / ended
  log                        level, message (a line of the server log)

The events are posted in batches as {"key": "...", "events": [...]}. When a
file is configured every event is also appended to it as one JSON line; the
web service imports such a file with "node server.js import FILE".

By default private and admin channel messages are not sent, and IP addresses
are masked in the log lines.
