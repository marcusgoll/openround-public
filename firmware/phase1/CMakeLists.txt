# OpenRound Phase 1 v0 — swing-capture instrument for the Seeed XIAO nRF52840 Sense.
# Build: west build -b xiao_ble/nrf52840/sense <this directory>
cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(openround_phase1)

target_sources(app PRIVATE src/main.c)
