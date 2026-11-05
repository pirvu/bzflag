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

#include "TouchJoystick.h"
#include "SDLJoystick.h"

#include <emscripten.h>

// State written by the page, see touchControls in web/shell.html
static bool touchEnabled = false;
static float touchX = 0.0f;
static float touchY = 0.0f;
static unsigned long touchButtons = 0;

static float clampAxis(float v)
{
    if (!(v == v)) // NaN
        return 0.0f;
    return v < -1.0f ? -1.0f : (v > 1.0f ? 1.0f : v);
}

extern "C" {

// Turns the touch joystick on or off. Off releases everything it held.
EMSCRIPTEN_KEEPALIVE void bzf_touch_enable(int on)
{
    touchEnabled = on != 0;
    touchX = touchY = 0.0f;
    touchButtons = 0;
}

// x: -1 full left .. 1 full right, y: -1 full forward .. 1 full reverse,
// the same as an SDL joystick
EMSCRIPTEN_KEEPALIVE void bzf_touch_axes(float x, float y)
{
    touchX = clampAxis(x);
    touchY = clampAxis(y);
}

// Bit n set means "Joystick Button n+1" is held
EMSCRIPTEN_KEEPALIVE void bzf_touch_buttons(unsigned int mask)
{
    touchButtons = mask;
}

}

TouchJoystick::TouchJoystick() : sdl(new SDLJoystick)
{
}

TouchJoystick::~TouchJoystick()
{
    delete sdl;
}

void TouchJoystick::initJoystick(const char* joystickName)
{
    sdl->initJoystick(joystickName);
}

bool TouchJoystick::joystick() const
{
    return touchEnabled || sdl->joystick();
}

void TouchJoystick::getJoy(float& x, float& y)
{
    sdl->getJoy(x, y);
    // the touch controls win while they are used, a gamepad otherwise
    if (touchEnabled && (touchX != 0.0f || touchY != 0.0f || !sdl->joystick()))
    {
        x = touchX;
        y = touchY;
    }
}

unsigned long TouchJoystick::getJoyButtons()
{
    unsigned long buttons = sdl->joystick() ? sdl->getJoyButtons() : 0;
    return touchEnabled ? buttons | touchButtons : buttons;
}

int TouchJoystick::getNumHats()
{
    return sdl->getNumHats();
}

void TouchJoystick::getJoyHat(int hat, float &hatX, float &hatY)
{
    sdl->getJoyHat(hat, hatX, hatY);
}

void TouchJoystick::getJoyDevices(std::vector<std::string> &list) const
{
    sdl->getJoyDevices(list);
}

void TouchJoystick::getJoyDeviceAxes(std::vector<std::string> &list) const
{
    sdl->getJoyDeviceAxes(list);
}

void TouchJoystick::setXAxis(const std::string &axis)
{
    sdl->setXAxis(axis);
}

void TouchJoystick::setYAxis(const std::string &axis)
{
    sdl->setYAxis(axis);
}

bool TouchJoystick::ffHasRumble() const
{
    return sdl->ffHasRumble();
}

void TouchJoystick::ffRumble(int count, float duration, float strong_motor, float weak_motor)
{
    sdl->ffRumble(count, duration, strong_motor, weak_motor);
}

// Local Variables: ***
// mode: C++ ***
// tab-width: 4 ***
// c-basic-offset: 4 ***
// indent-tabs-mode: nil ***
// End: ***
// ex: shiftwidth=4 tabstop=4
