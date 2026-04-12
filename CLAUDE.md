# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Geforkte versie van ThingsBoard open-source IoT platform met NauticSensors-specifieke aanpassingen.

Zie [README.md](./README.md) voor uitgebreide documentatie van de alarm flow architectuur.
Zie [UPGRADING.md](./UPGRADING.md) voor het upgrade-proces bij nieuwe ThingsBoard releases.

## NauticSensors Customizations (bluestar-4.3, gebaseerd op release-4.3)

1. **Alarm Notification Enhancements** - Nu native upstream in release-4.3:
   - `${alarmOriginatorLabel}` - Device label (upstream)
   - `${details.*}` - Toegang tot alarm details (upstream, was `${alarmDetails.*}` in bluestar-4.2)

2. **Server Attribute Substitution** - `${ss:attributeName}` pattern in alarm details (custom, in AlarmState.java)

## Build Commands

**Vereist: Java 17** (Gradle 7.3.3 is niet compatible met Java 21+). Via SDKMAN:

```bash
sdk use java 17.0.13-tem
```

```bash
# Build alleen tb-node + web-ui Docker images (wat we nodig hebben)
DOCKER_CLI_EXPERIMENTAL=enabled DOCKER_BUILDKIT=0 \
  mvn -T0.8C license:format clean install -DskipTests -Ddockerfile.skip=false \
  -pl msa/web-ui,msa/tb-node -am

# Build alles (inclusief Docker images, kan falen op js-executor/monitoring)
mvn -T 0.8C license:format clean install -DskipTests -Ddockerfile.skip=false
```

## Relatie tot Andere Projecten

- Ontvangt data van `bluestar-core` persist service
- Backend API voor `flutter_thingsboard_app`
