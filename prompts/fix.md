Tu travailles sur le projet Node26 pendant le cycle autonome {{CYCLE_NUMBER}}.

Voici le rapport comportemental obtenu exclusivement par l’API Node26 :

<rapport>
{{REPORT}}
</rapport>

Objectif :

1. Pour chaque peons dans le rapport tu vas trouver plusieurs preconisations dans la section "6. Préconisations". Vérifie les préconisations dans le code et regroupe celles qui ont une cause commune.
2. Classe-les selon la "Priorité", fréquence, nombre de péons concernés et confiance.
3. Implémente jusqu’aux dix corrections prioritaires réellement démontrables.
4. Ajoute des tests déterministes distincts pour chaque correction.
5. Exécute les tests pertinents puis la suite complète.
6. Termine par un compte rendu structuré : causes, corrections, fichiers, tests et risques restants.

Contraintes :

- Respecte AGENTS.md et l’architecture hexagonale.
- Préserve toutes les modifications préexistantes de l’utilisateur.
- N’utilise jamais git switch, checkout, branch, reset, clean, commit, merge, rebase ou push.
- Ne modifie ni Dockerfile, ni docker-compose.yml, ni les rapports, ni le projet node26Supervisor.
- Ne redéploie pas et ne lance pas de simulation : le superviseur le fera après validation.
- N’applique aucune recommandation non confirmée par le code.
