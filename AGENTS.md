# Conventions

- Le superviseur communique avec Node26 par ses API HTTP pour les mondes, analyses, rapports et simulations.
- L'accès au dépôt Node26 est réservé au SDK Codex et aux commandes locales de validation/déploiement.
- Ne jamais modifier ou supprimer les changements préexistants du dépôt cible.
- Chaque cycle doit produire une trace, une évaluation et un état persistant, y compris en cas d'échec.
- Les routes HTTP doivent rester fines ; l'orchestration appartient à `Supervisor`.
- TypeScript doit compiler en mode strict et les nouvelles règles de notation doivent être testées.
