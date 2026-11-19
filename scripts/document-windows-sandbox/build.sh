#!/bin/sh
set -eu
cd "$(dirname "$0")"
x86_64-w64-mingw32-gcc -std=c17 -municode -Os -Wall -Wextra -Werror \
  -Wl,--no-insert-timestamp -s launcher.c -o launcher-x64.exe -luserenv -ladvapi32
