# cliques-screenshots
Cliques Screenshots contains a nodejs app that subscribe to captureScreenshot message from Google pubsub service, and whenever the message received, capture a screenshot from the requested website.

## Folder structure

	.
	├── README.md
	├── bq_config.json
	├── bq_config_dev.json
	├── config -> ../cliques-config
	├── index.js
	├── lib
	│   ├── logger.js
	│   └── screenshots_logging.js
	├── package.json
	├── screenshots
	├── services
	│   └── crawler.js
	└── setup.sh