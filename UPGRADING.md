# ThingsBoard Upgrade Guide

Dit document beschrijft hoe je de NauticSensors ThingsBoard-fork (`bluestar-4.3`) upgradet naar een nieuwe upstream release.

## Overzicht

NauticSensors onderhoud een fork van [thingsboard/thingsboard](https://github.com/thingsboard/thingsboard) met custom patches. Bij een nieuwe ThingsBoard release rebasen we onze patches op de nieuwe versie, bouwen we Docker images, en deployen we via Helm.

**Belangrijk — upgrade-volgorde:**
ThingsBoard releases bevatten database-migraties die sequentieel uitgevoerd moeten worden. Je kunt **geen versies overslaan**. Als er tussenliggende releases zijn (bijv. 4.2.x → 4.3.0 → 4.3.1), moet elke versie doorlopen worden voor de DB-migraties. De tussenliggende stappen kunnen met officiële ThingsBoard Docker images (geen custom fork nodig). Alleen de laatste stap gebruikt onze custom fork.

**Uitzondering — patch releases binnen dezelfde minor:**
Patch releases (bijv. 4.3.0.1 → 4.3.1 → 4.3.1.1) delen hetzelfde DB-schema. Hiervoor is **geen `UPGRADE_TB=true` nodig**. Je kunt direct de nieuwe image deployen zonder migratie-stap. De upgrade validator accepteert alleen cross-minor upgrades (bijv. 4.2.x → 4.3.x).

## Huidige setup

| Component | Waarde |
|---|---|
| Fork repo | `git@github.com:NauticSensors/thingsboard.git` |
| Branch | `bluestar-4.3` (gebaseerd op `release-4.3`) |
| Upstream | `https://github.com/thingsboard/thingsboard.git` |
| Docker registry | `registry.local.nauticsensors.com/bluestar/` |
| Helm chart | `homelab-infra/apps/helm/thingsboard/thingsboard-cluster/` |

## Custom patches

Deze patches moeten behouden blijven bij elke upgrade:

1. **Server Attribute Substitution** — `${ss:attributeName}` pattern in alarm details
   - Bestand: `rule-engine/.../profile/AlarmState.java` (`resolveAttributePatterns()`)
   - Zie [README.md](./README.md) voor details

2. **BlueStar branding** — Logo en e-mail templates

> **Tip:** Na elke upgrade, controleer of upstream patches heeft overgenomen die onze customizations overbodig maken (zoals gebeurd is met `${alarmOriginatorLabel}` en `${details.*}` in 4.3).

## Stap 1 — Upgrade-pad bepalen

Voordat je begint, bepaal welke tussenliggende releases er zijn. ThingsBoard DB-migraties moeten **per versie sequentieel** worden uitgevoerd.

### Upstream fetchen

```bash
cd thingsboard

# Upstream remote configureren (eenmalig)
git remote add upstream https://github.com/thingsboard/thingsboard.git

git fetch upstream --tags
```

### Beschikbare releases bekijken

```bash
# Tags in de 4.3.x reeks
git tag -l 'v4.3*' | sort -V

# Versie van de upstream release-4.3 branch
git show upstream/release-4.3:pom.xml | grep '<version>' | head -1
```

### Upgrade-pad vastleggen

Lijst alle versies op tussen je huidige en de doelversie. Voorbeeld:

| Stap | Versie | Image | Doel |
|------|--------|-------|------|
| 1 | 4.3.1 | `thingsboard/tb-node:4.3.1` (officieel) | DB-migraties |
| 2 | 4.3.1.1 | `registry.local.nauticsensors.com/bluestar/tb-node:4.3.1.1` (fork) | Finale versie |

> **Let op:** Tussenliggende stappen gebruiken de **officiële ThingsBoard Docker images** van Docker Hub. Alleen de laatste stap gebruikt onze custom fork.

## Stap 2 — Custom fork bouwen (kan parallel met stap 3)

Bouw alvast de custom fork van de **doelversie** (de laatste stap in het upgrade-pad). Dit kan parallel met het uitvoeren van de tussenliggende DB-migraties.

### Rebase op nieuwe versie

**Patch upgrade** (bijv. 4.3.0 → 4.3.1) — blijft op dezelfde branch:

```bash
git checkout bluestar-4.3
git rebase upstream/release-4.3
```

**Minor/major upgrade** (bijv. 4.3 → 4.4) — nieuwe branch:

```bash
git checkout bluestar-4.3
git checkout -b bluestar-4.4
git rebase upstream/release-4.4
```

### Conflicts oplossen

Verwacht conflicts in:
- `AlarmState.java` — onze `resolveAttributePatterns()` method
- Branding-bestanden (logo, e-mail templates)
- `pom.xml` — als we de versie handmatig hadden aangepast

Bij elk conflict:
1. Bekijk of upstream onze wijziging heeft overgenomen → dan de upstream versie accepteren
2. Zo niet → onze patch opnieuw toepassen bovenop de upstream code
3. `git rebase --continue` na elk opgelost conflict

### Versie controleren

```bash
grep '<version>' pom.xml | head -1
```

De versie wordt bepaald door upstream (bijv. `4.3.1.1`). Pas deze **niet** handmatig aan.

### Bouwen

**Vereist: Java 17** — Gradle 7.3.3 (gebruikt door de packaging modules) is niet compatible met Java 21+. Gebruik SDKMAN om te switchen:

```bash
sdk use java 17.0.13-tem
```

Bouw alleen de modules die we nodig hebben (`tb-node` en `web-ui`):

```bash
DOCKER_CLI_EXPERIMENTAL=enabled DOCKER_BUILDKIT=0 \
  mvn -T0.8C license:format clean install -DskipTests -Ddockerfile.skip=false \
  -pl msa/web-ui,msa/tb-node -am
```

Dit bouwt Docker images lokaal als `thingsboard/tb-node:<versie>` en `thingsboard/tb-web-ui:<versie>`.

> **Let op:** Een volledige build (`mvn ... clean install` zonder `-pl`) kan falen op `js-executor` en `monitoring` modules door Gradle-incompatibiliteit. Die modules gebruiken we niet (we draaien de officiële Docker Hub images ervoor).

### Docker images taggen en pushen

```bash
VERSION=4.3.1.1  # pas aan naar de doelversie

docker tag thingsboard/tb-node:$VERSION registry.local.nauticsensors.com/bluestar/tb-node:$VERSION
docker tag thingsboard/tb-web-ui:$VERSION registry.local.nauticsensors.com/bluestar/tb-web-ui:$VERSION

docker push registry.local.nauticsensors.com/bluestar/tb-node:$VERSION
docker push registry.local.nauticsensors.com/bluestar/tb-web-ui:$VERSION
```

## Stap 3 — Database backup

**Altijd** een database backup maken vóór de eerste DB-migratie.

PostgreSQL draait extern (niet in k8s) op `192.168.1.241`:

```bash
ssh simon@192.168.1.241 "PGPASSWORD=thingsboard pg_dump -h localhost -U thingsboard -d thingsboard_370 -F c -f /tmp/thingsboard_backup_pre_upgrade_\$(date +%Y%m%d_%H%M%S).dump"
```

## Stap 4 — Tussenliggende DB-migraties uitvoeren

Voor elke tussenliggende versie in het upgrade-pad (zie stap 1) voer je een DB-migratie uit met het **officiële ThingsBoard Docker image**. Dit hoeft niet met onze custom fork — het gaat alleen om het uitvoeren van de database schema-migraties.

### Hoe DB-migraties werken in het cluster

De TB-core StatefulSet in `homelab-infra` heeft twee relevante environment variables:

```yaml
# templates/node/msa/core-statefulset.yml
- name: UPGRADE_TB
  value: "true"       # zet op "true" om migratie te triggeren
- name: FROM_VERSION
  value: "4.2.0"      # de versie waar je VANDAAN upgradet
```

Wanneer een tb-core pod start met `UPGRADE_TB=true`:
1. **Eén pod** pakt de migratie-lock en voert de DB-migraties uit
2. Na succesvolle migratie **stopt deze pod** (exit 0) — dit is verwacht gedrag
3. Kubernetes herstart de pod, maar de migratie is al uitgevoerd
4. **Bij herstart met `UPGRADE_TB=true`** terwijl de migratie al gedraaid heeft, kan de pod in een error/restart loop komen — **dit is verwacht**. Ga direct door naar de volgende stap om `UPGRADE_TB` weer op `false` te zetten

### Per tussenliggende versie

Herhaal voor elke tussenliggende versie (bijv. 4.3.1):

#### 4a. Helm values aanpassen voor migratie

In `homelab-infra/apps/helm/thingsboard/thingsboard-cluster/`:

**`values.yaml`** — image tijdelijk naar officiële ThingsBoard:

```yaml
node:
  image:
    repository: thingsboard/tb-node
    tag: "4.3.1"
```

**`templates/node/msa/core-statefulset.yml`** — upgrade flags:

```yaml
- name: UPGRADE_TB
  value: "true"
- name: FROM_VERSION
  value: "4.3.0"   # de vorige versie
```

#### 4b. Deployen

```bash
cd homelab-infra/apps/helm/thingsboard/thingsboard-cluster
helm upgrade thingsboard . -n bluestar \
  --set node.image.repository=thingsboard/tb-node \
  --set node.image.tag=4.3.1 \
  --set engine.image.repository=thingsboard/tb-node \
  --set engine.image.tag=4.3.1 \
  --set web.image.repository=thingsboard/tb-web-ui \
  --set web.image.tag=4.3.1 \
  --set global.tag=4.3.1 \
  --reuse-values
```

> **⚠ Drift-waarschuwing**: `--set` overrides leven alleen in de helm release-state, **niet in `values.yaml`**. Werk `values.yaml` in git altijd direct bij naar dezelfde tags. Zonder dat rolt een latere `helm upgrade` (zonder `--set`) de tussenversie terug. Zie [Bekende valkuilen na upgrade](#bekende-valkuilen-na-upgrade).

#### 4c. Migratie volgen

```bash
# Volg de logs van de core pod
kubectl logs -n bluestar -l app=thingsboard-core --tail=200 -f
```

Wacht tot je ziet dat de migratie succesvol is afgerond. De pod zal daarna stoppen (exit 0). Dit is verwacht.

#### 4d. Upgrade flags resetten

Na succesvolle migratie **direct** `UPGRADE_TB` weer op `false` zetten om de restart-loop te stoppen:

```yaml
- name: UPGRADE_TB
  value: "false"
```

Opnieuw deployen:

```bash
helm upgrade thingsboard . -n bluestar --reuse-values
```

Wacht tot de pods stabiel draaien voordat je doorgaat naar de volgende versie.

## Stap 5 — Finale versie deployen (custom fork)

Nu alle tussenliggende migraties zijn uitgevoerd, deploy de custom fork als laatste stap.

### Helm chart updaten

**`Chart.yaml`**:

```yaml
appVersion: "4.3.1"  # major.minor.patch (zonder build nummer)
```

**`values.yaml`** — image naar onze custom fork. Werk **alle vier** tag-locaties bij in dezelfde commit (de `global.tag` lekt door naar upstream `tb-http-transport` en `tb-js-executor`, zie [Bekende valkuilen na upgrade](#bekende-valkuilen-na-upgrade)):

```yaml
global:
  tag: "4.3.1.1"

node:
  image:
    repository: registry.local.nauticsensors.com/bluestar/tb-node
    tag: "4.3.1.1"

engine:
  image:
    repository: registry.local.nauticsensors.com/bluestar/tb-node
    tag: "4.3.1.1"

web:
  image:
    repository: registry.local.nauticsensors.com/bluestar/tb-web-ui
    tag: "4.3.1.1"
  # tb-web-ui is een Node.js proces met liveness probe op /index.html (timeout 10s, hardcoded
  # in de chart). Met de chart-default 100m/100Mi blokkeert de event loop bij piek-load → probe
  # timeout → restart-loop → cloudflared krijgt "context canceled" → bezoekers zien een
  # Cloudflare error pagina. Onderstaande resources zijn geverifieerd voldoende voor productie.
  resources:
    limits:
      cpu: "500m"
      memory: 256Mi
    requests:
      cpu: "200m"
      memory: 128Mi
```

**`templates/node/msa/core-statefulset.yml`** — upgrade flags:

```yaml
- name: UPGRADE_TB
  value: "true"
- name: FROM_VERSION
  value: "4.3.1"   # de vorige tussenversie
```

### Deployen

Bij voorkeur **zonder `--set`**, vanuit de bijgewerkte `values.yaml` in `homelab-infra/apps/helm/thingsboard/`:

```bash
cd homelab-infra/apps/helm/thingsboard
helm upgrade thingsboard ./thingsboard-cluster -n bluestar -f values.yaml
```

Verifieer eerst de diff (vereist plugin `helm-diff`):

```bash
helm diff upgrade thingsboard ./thingsboard-cluster -n bluestar -f values.yaml
```

Alleen wanneer je écht een tijdelijke override nodig hebt (bijv. een testbuild) gebruik je `--set` — onthoud dan dat je `values.yaml` daarna alsnog moet bijwerken om drift te voorkomen.

### Migratie volgen en afronden

Dit is alleen nodig bij **cross-minor upgrades** (bijv. 4.2.x → 4.3.x). Bij patch releases binnen dezelfde minor is geen migratie nodig en kun je deze stap overslaan.

Bij cross-minor upgrades, zelfde procedure als stap 4c/4d:
1. Volg logs, wacht op succesvolle migratie
2. Pod stopt na migratie (verwacht)
3. Zet `UPGRADE_TB` terug naar `false`
4. Deploy opnieuw
5. Wacht tot alle pods stabiel draaien

## Stap 6 — Verificatie

1. Controleer of de UI bereikbaar is en de juiste versie toont
2. Test alarm flow (de custom `${ss:...}` substitutie) met een test-device
3. Controleer logs op errors:
   ```bash
   kubectl logs -n bluestar -l app=thingsboard-core --tail=100
   ```

## Stap 7 — Afronden

```bash
# Push de gerebaste fork-branch naar origin
cd thingsboard
git push origin bluestar-4.3 --force-with-lease

# Bij een minor/major upgrade: push de nieuwe branch
git push origin bluestar-4.4 -u
```

Commit de Helm chart wijzigingen in `homelab-infra`.

## Checklist

### Voorbereiding
- [ ] Upstream remote geconfigureerd
- [ ] `git fetch upstream --tags`
- [ ] Release notes gelezen voor alle tussenliggende versies
- [ ] Upgrade-pad vastgelegd (alle tussenversies geïdentificeerd)
- [ ] Gecontroleerd of upstream onze customizations heeft overgenomen

### Custom fork bouwen
- [ ] Rebase op nieuwe versie (conflicts opgelost)
- [ ] Custom patches nog intact (check `resolveAttributePatterns()` in AlarmState.java)
- [ ] Gebouwd met Maven (`-DskipTests -Ddockerfile.skip=false`)
- [ ] Docker images getagd en gepusht naar `registry.local.nauticsensors.com`

### Database
- [ ] Database backup gemaakt

### Tussenliggende migraties
- [ ] Per tussenversie: officieel TB image ingesteld
- [ ] Per tussenversie: `UPGRADE_TB=true` + juiste `FROM_VERSION`
- [ ] Per tussenversie: migratie succesvol afgerond in logs
- [ ] Per tussenversie: `UPGRADE_TB=false` teruggezet, pods stabiel

### Finale deployment
- [ ] Custom fork image ingesteld
- [ ] `UPGRADE_TB=true` + `FROM_VERSION` van laatste tussenversie
- [ ] Migratie succesvol afgerond
- [ ] `UPGRADE_TB=false` teruggezet
- [ ] `Chart.yaml` appVersion bijgewerkt
- [ ] **`values.yaml` in sync met live cluster** — zie [Bekende valkuilen na upgrade](#bekende-valkuilen-na-upgrade)
- [ ] UI bereikbaar + juiste versie
- [ ] Alarm flow getest
- [ ] Fork-branch gepusht naar origin
- [ ] Helm chart wijzigingen gecommit in homelab-infra

## Bekende valkuilen na upgrade

Verzameld uit een eerdere upgrade-cyclus die deze tekortkomingen aan het licht bracht.

### 1. Drift tussen `values.yaml` en helm release-state

`helm upgrade --set ... --reuse-values` schrijft de overrides **niet terug naar `values.yaml`**. Ze leven alleen in de helm release secret. Gevolg: `values.yaml` blijft op de oude tags staan terwijl de cluster op de nieuwe versie draait. Een latere `helm upgrade -f values.yaml` (zonder `--set`) **rolt het cluster terug** naar de oude tags.

**Detecteer drift** na elke deployment:

```bash
# Toont de overrides zoals helm ze ziet
helm -n bluestar get values thingsboard

# Diff helm-render vs huidige cluster (vereist helm-diff plugin)
cd homelab-infra/apps/helm/thingsboard
helm diff upgrade thingsboard ./thingsboard-cluster -n bluestar -f values.yaml
```

Als die diff niet leeg is op `image:` regels: `values.yaml` is out-of-sync. Werk hem bij en commit voordat iemand anders een routine-upgrade draait.

**Voorkeursmethode**: deploy altijd via `-f values.yaml` (zonder `--set`). `--set` alleen voor echte tijdelijke overrides, en dan altijd de waarde direct erna ook in `values.yaml` zetten.

### 2. `global.tag` heeft brede impact

Het `global.tag` veld in `values.yaml` is **niet alleen** voor de fork-images. Via fallback-logica in `thingsboard-cluster/templates/_helpers.tpl` lekt het naar:

| Component | Image | Tag-bron |
|---|---|---|
| `tb-core` (StatefulSet) | `registry.local.nauticsensors.com/bluestar/tb-node` | `node.image.tag` |
| `tb-rule-engine` (StatefulSet) | `registry.local.nauticsensors.com/bluestar/tb-node` | `engine.image.tag` |
| `tb-web-ui` (Deployment) | `registry.local.nauticsensors.com/bluestar/tb-web-ui` | `web.image.tag` |
| `tb-http-transport` (StatefulSet) | `thingsboard/tb-http-transport` (upstream) | `global.tag`, gestripped tot 3-octet → `4.3.1.1` wordt `4.3.1` |
| `tb-js-executor` (Deployment ×5) | `thingsboard/tb-js-executor` (upstream) | idem |

Wanneer je `global.tag` bumpt verschuiven dus ook `tb-http-transport` en `tb-js-executor` mee naar de bijbehorende upstream patch versie. Dit is meestal gewenst (consistent), maar wees je ervan bewust dat `--set global.tag=...` 5 services raakt, niet 3.

### 3. `tb-web-ui` resource limits standaard te laag

De chart-default in `thingsboard-cluster/values.yaml` is **`100m CPU / 100Mi memory`** voor `web.resources` (zowel limit als request). Onder echte productie-load blokkeert de Node.js event loop kortstondig (GC, piek requests) → liveness probe op `/index.html` (timeout `10s`, hardcoded in [tb-web-ui-deployment.yml](../homelab-infra/apps/helm/thingsboard/thingsboard-cluster/templates/web/tb-web-ui-deployment.yml)) faalt → kubelet `SIGTERM` → pod restart.

Symptomen:
- `RESTARTS` op `thingsboard-web-ui` loopt op met `Reason: Completed` (exit 0, want SIGTERM is netjes opgevangen)
- Events: `Liveness probe failed: context deadline exceeded`
- In `cloudflared` logs: bursts van `Failed to proxy HTTP: Incoming request ended abruptly: context canceled` met `originService=https://traefik.traefik.svc.cluster.local:443`
- Bezoekers krijgen tijdens de ~10-30s downtime een Cloudflare error pagina

**Aanbevolen waarden** in `homelab-infra/apps/helm/thingsboard/values.yaml`:

```yaml
web:
  resources:
    limits:   { cpu: "500m", memory: 256Mi }
    requests: { cpu: "200m", memory: 128Mi }
```

Deze haalt de pod uit `Guaranteed` QoS (waar requests==limits) naar `Burstable`, wat hier gewenst is — we willen juist headroom geven voor pieken.

### 4. Liveness `timeoutSeconds: 10` is hardcoded

In [tb-web-ui-deployment.yml](../homelab-infra/apps/helm/thingsboard/thingsboard-cluster/templates/web/tb-web-ui-deployment.yml) staat de liveness probe niet onder `.Values` — `timeoutSeconds: 10` is letterlijk in het template. Als de resource-bump uit punt 3 niet voldoende blijkt, vergt aanpassen van de timeout een chart-template wijziging (niet alleen values).

### Hygiëne-stappen na elke upgrade

1. `helm -n bluestar get values thingsboard` — alle tags moeten matchen met `values.yaml` in git
2. `helm diff upgrade thingsboard ./thingsboard-cluster -n bluestar -f values.yaml` — moet leeg of alleen "no changes" zijn
3. `kubectl -n bluestar get pods -l app=thingsboard-web-ui` — restart-count moet 24u stabiel blijven na de upgrade
4. Commit de finale `values.yaml` in `homelab-infra` zodat de live state reproduceerbaar is
