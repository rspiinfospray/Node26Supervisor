# node26Supervisor

Superviseur autonome extrait de Node26. Il utilise le SDK TypeScript officiel `@openai/codex-sdk`, pilote Node26 uniquement par ses API HTTP pour les données de simulation, puis affiche chaque étape et chaque note dans une interface web.

## Prérequis

- Docker Desktop
- Node26 disponible sur `http://localhost:8080`
- Une session Codex authentifiée sur la machine

## Lancement

```powershell
cd C:\Users\amne\IdeaProjects\node26Supervisor
.\start-supervisor.cmd
```

Ouvrir ensuite `http://localhost:8090`.

Node.js, le SDK Codex, TypeScript, le client Docker et toutes les dépendances npm sont installés uniquement dans l'image. Le dépôt Node26 est monté dans le conteneur pour permettre les corrections. Le dossier d'authentification Codex existant est monté sous `/root/.codex`, et l'état du superviseur est conservé dans le volume Docker `supervisor-data`.

Les variables disponibles sont documentées dans `.env.example`. Pour arrêter le service :

```powershell
docker compose down
```

## Déroulement d'un cycle

1. Sélection d'un monde terminé dans l'interface.
2. Lecture du monde, de l'analyse et des diagnostics via l'API Node26.
3. Génération du rapport comportemental par l'API OpenAI Responses avec le modèle configuré.
4. Lecture du rapport et correction du dépôt local Node26 par le SDK Codex.
4. Compilation et tests via `docker compose build backend`.
5. Déploiement via `docker compose up -d backend`.
6. Création et lancement, via API, d'un monde de contrôle de même graine.
7. Comparaison avant/après et revue Codex en lecture seule.
8. Note sur 100, historique persistant dans `data/state.json`, puis cycle suivant.

## Barème

- Build et tests : 25 points
- Déploiement : 10 points
- Simulation terminée : 10 points
- Survie comparée : 25 points
- Activité comparée : 10 points
- Revue qualitative Codex : 20 points

Le superviseur ne réinitialise jamais automatiquement Git lorsqu'un score est faible, afin de préserver les modifications utilisateur. Il signale la régression dans l'interface.
