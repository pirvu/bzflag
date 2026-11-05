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

/* TouchJoystick:
 *  The browser build's joystick. The page's touch controls (on screen
 *  stick, phone tilt, buttons) feed it through the bzf_touch_* functions;
 *  while they are off it is a plain SDL joystick, so gamepads still work.
 */

#ifndef BZF_TOUCHJOY_H
#define BZF_TOUCHJOY_H

#include "BzfJoystick.h"

class TouchJoystick final : public BzfJoystick
{
public:
    TouchJoystick();
    ~TouchJoystick();

    void    initJoystick(const char* joystickName) override;
    bool    joystick() const override;
    void    getJoy(float& x, float& y) override;
    unsigned long getJoyButtons() override;
    int     getNumHats() override;
    void    getJoyHat(int hat, float &hatX, float &hatY) override;
    void    getJoyDevices(std::vector<std::string> &list) const override;
    void    getJoyDeviceAxes(std::vector<std::string> &list) const override;
    void    setXAxis(const std::string &axis) override;
    void    setYAxis(const std::string &axis) override;

    bool    ffHasRumble() const override;
    void    ffRumble(int count, float duration, float strong_motor, float weak_motor = 0.0f) override;

private:
    BzfJoystick *sdl;
};

#endif // BZF_TOUCHJOY_H

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
