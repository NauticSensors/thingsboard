# ThingsBoard Upgrade Guide

Dit document beschrijft hoe je de NauticSensors ThingsBoard-fork (`bluestar-4.3`) upgradet naar een nieuwe upstream release.

## Overzicht

NauticSensors onderhoud een fork van [thingsboard/thingsboard](https://github.com/thingsboard/thingsboard) met custom patches. Bij een nieuwe ThingsBoard release rebasen we onze patches op de nieuwe versie, bouwen we Docker images, en deployen we via Helm.

**Belangrijk — upgrade-volgorde:**
ThingsBoard releases bevatten database-migraties die sequentieel uitgevoerd moeten worden. Je kunt **geen versies overslaan**. Als er tussenliggende releases zijn (bijv. 4.3.0.1 → 4.3.1 → 4.3.1.1), moet elke versie doorlopen worden voor de DB-migraties. De tussenliggende stappen kunnen met officiële ThingsBoard Docker images (geen custom fork nodig). Alleen de laatste stap gebruikt onze custom fork.

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

```bash
mvn -T 0.8C license:format clean install -DskipTests -Ddockerfile.skip=false
```

Dit bouwt Docker images lokaal als `thingsboard/tb-node:<versie>` en `thingsboard/tb-web-ui:<versie>`.

### Docker images taggen en pushen

```bash
VERSION=4.3.1.1  # pas aan naar de doelversie

docker tag thingsboard/tb-node:$VERSION registry.local.nauticsensors.com/bluestar/tb-node:$VERSION
docker tag thingsboard/tb-web-ui:$VERSION registry.local.nauticsensors.com/bluestar/tb-web-ui:$VERSION

docker push registry.local.nauticsensors.com/bluestar/tb-node:$VERSION
docker push registry.local.nauticsensors.com/bluestar/tb-web-ui:$VERSION
```

## Stap 3 — Database backup

**Altijd** een database backup maken vóór de eerste DB-migratie:

```bash
kubectl exec -n thingsboard <postgres-pod> -- pg_dump -U postgres thingsboard > backup_pre_upgrade.sql
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
helm upgrade thingsboard . -n thingsboard
```

#### 4c. Migratie volgen

```bash
# Volg de logs van de core pod
kubectl logs -n thingsboard -l app=tb-core --tail=200 -f
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
helm upgrade thingsboard . -n thingsboard
```

Wacht tot de pods stabiel draaien voordat je doorgaat naar de volgende versie.

## Stap 5 — Finale versie deployen (custom fork)

Nu alle tussenliggende migraties zijn uitgevoerd, deploy de custom fork als laatste stap.

### Helm chart updaten

**`Chart.yaml`**:

```yaml
appVersion: "4.3.1"  # major.minor.patch (zonder build nummer)
```

**`values.yaml`** — image naar onze custom fork:

```yaml
node:
  image:
    repository: registry.local.nauticsensors.com/bluestar/tb-node
    tag: "4.3.1.1"
```

**`templates/node/msa/core-statefulset.yml`** — upgrade flags:

```yaml
- name: UPGRADE_TB
  value: "true"
- name: FROM_VERSION
  value: "4.3.1"   # de vorige tussenversie
```

### Deployen

```bash
helm upgrade thingsboard . -n thingsboard
```

### Migratie volgen en afronden

Zelfde procedure als stap 4c/4d:
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
   kubectl logs -n thingsboard -l app=tb-core --tail=100
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
- [ ] UI bereikbaar + juiste versie
- [ ] Alarm flow getest
- [ ] Fork-branch gepusht naar origin
- [ ] Helm chart wijzigingen gecommit in homelab-infra
