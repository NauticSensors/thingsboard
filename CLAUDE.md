# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Geforkte versie van ThingsBoard open-source IoT platform met NauticSensors-specifieke aanpassingen.

Zie [README.md](./README.md) voor uitgebreide documentatie van de alarm flow architectuur.

## NauticSensors Customizations (bluestar-4.3, gebaseerd op release-4.3)

1. **Alarm Notification Enhancements** - Nu native upstream in release-4.3:
   - `${alarmOriginatorLabel}` - Device label (upstream)
   - `${details.*}` - Toegang tot alarm details (upstream, was `${alarmDetails.*}` in bluestar-4.2)

2. **Server Attribute Substitution** - `${ss:attributeName}` pattern in alarm details (custom, in AlarmState.java)

## Build Commands

```bash
# Build alles (inclusief Docker images)
mvn -T 0.8C license:format clean install -DskipTests -Ddockerfile.skip=false

# Build alleen Web UI
./build.sh msa/web-ui

# Build Web UI + tb-node
./build.sh msa/web-ui,msa/tb-node
```

## Relatie tot Andere Projecten

- Ontvangt data van `bluestar-core` persist service
- Backend API voor `flutter_thingsboard_app`
