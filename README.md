# cliques-screenshots
Cliques Screenshots contains a nodejs app that subscribe to captureScreenshot message from Google pubsub service, and whenever the message received, capture a screenshot from the requested website.

## Folder structure

	.
	├── README.md - documentation
	├── bq_config.json
	├── bq_config_dev.json
	├── config -> ../cliques-config - config folder
	├── index.js - app main entry
	├── lib
	│   ├── logger.js - app logger
	│   └── screenshots_logging.js - screenshot logging functionalities
	├── package.json - dependencies
	├── screenshots - the folder where screenshot images saved
	├── services
	│   └── crawler.js - the phantomjs screenshot rendering service
	└── setup.sh - shell script to set up app

