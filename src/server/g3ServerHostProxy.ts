/// <reference path="./types.ts"/>

namespace ts.server {
    function isGenerated(path: string) {
        const GEN_EXT = ['ngsummary', 'ngstyle', 'ngfactory'];
        const TS_EXT = ['ts', 'tsx', 'd.ts'];

        for (const gen of GEN_EXT) {
            for (const ext of TS_EXT) {
                if (fileExtensionIs(path, gen + '.' + ext)) {
                    return true;
                }
            }
        }
        return false;
    }

    export function getG3ServerHostProxy(
      tsconfigPath: string,
      host: ServerHost,
      logger: Logger): ServerHost {

        let proxyHost:ServerHost = (<any>Object).assign({}, host);

        const {config, error} = readConfigFile(tsconfigPath, proxyHost.readFile);
        if (error) {
            return host;
        }
        const projectDir = getDirectoryPath(tsconfigPath);

        // Get the files list from the tsconfig.
        let {options, errors, fileNames} =
            parseJsonConfigFileContent(config, proxyHost, projectDir);

        if (errors && errors.length !== 0) {
            return host;
        }

        // All google3 projects have rootDits set. Don't proxy if rootDirs is
        // not set.
        if (!options.rootDirs) {
            return host;
        }

        // Get the list of files into a map.
        let fileMap: {[k: string]: boolean} = {};

        // Just put the directory of the files in the known directories list.
        // We don't rely on the behavior of walking up the directories to find
        // the node_modules. (This part may not work for opensource)
        let directoryMap: {[k: string]: boolean} = {};
        let rootDirs = options.rootDirs;

        // Add all the rootDirs to the known directories list.
        rootDirs.forEach(d => {
            logger.info('Adding rootdir: ' + d);
            directoryMap[d] = true;
        });

        // Add the tsconfig.json as a valid project file.
        fileMap[tsconfigPath] = true;

        // For each file add to the filesMap and add their directory
        // (and few directories above them) to the directoryMap.
        fileNames.forEach(f => {
            f = proxyHost.resolvePath(f);
            logger.info('Adding file: ' + f);
            fileMap[f] = true;
            // TODO(viks): How deep should we go? Is 2 enough?
            for (let i = 0; i < 2; i++) {
                f = getDirectoryPath(f);
                if (f) {
                    logger.info('Adding dir: ' + getDirectoryPath(f));
                    directoryMap[f] = true;
                } else {
                    break;
                }
            }
        });

        // Override the fileExists in the ServerHost to reply using the fileMap
        // instead of hitting the (network) file system.
        proxyHost.fileExists = (path: string) => {
            path = proxyHost.resolvePath(path);
            if (path in fileMap) {
                // File found in map!
                logger.info('Found: ' + path);
                return true;
            } else {
                // Only ever allow looking in the filesystem for files inside
                // the project dir. Allows for discovery of new source files
                // in the project without having to rebuild tsconfig.
                // Skip generated files since the tsconfig would have to generated anyways
                // while regenerating these.
                if (!isGenerated(path)) {
                    for (const rootDir of rootDirs) {
                        if (path.indexOf(rootDir) === 0) {
                            logger.info('Search: ' + path);
                            return host.fileExists(path);
                        }
                    }
                }
            }
            // File not in map. Just return false without hitting file system.
            logger.info('Did not find: ' + path);
            return false;
        }

        // Override the directoryExists in the ServerHost to reply using the
        // directoryMap without hitting the file system.
        proxyHost.directoryExists = (path: string) => {
            path = proxyHost.resolvePath(path);
            if (path in directoryMap) {
                logger.info('Dir Found: ' + path);
                return true;
            }
            logger.info('Dir NOT Found: ' + path);
            return false;
        }

        return proxyHost;
    }
}
