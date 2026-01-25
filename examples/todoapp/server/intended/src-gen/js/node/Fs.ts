import {Register} from "../../genes/Register.js"

/**
Most FS functions now support passing `String` and `Buffer`.
This type is used for path arguments and allows passing either of those.
*/
export type FsPath = string | globalThis.Buffer

/**
Possible options for `Fs.watchFile`.
*/
export type FsWatchFileOptions = {
	/**
	indicates how often the target should be polled, in milliseconds
	default: 5007
	*/
	interval?: number | null,
	/**
	indicates whether the process should continue to run as long as files are being watched
	default: true
	*/
	persistent?: boolean | null
}

/**
The `mode` argument used by `Fs.open` and related functions
can be either an integer or a string with octal number.
*/
export type FsMode = number | string

/**
Possible options for `Fs.writeFile` and `Fs.appendFile`.
*/
export type FsWriteFileOptions = {
	/**
	Encoding for writing strings.
	Defaults to 'utf8'.
	Ignored if data is a buffer
	*/
	encoding?: string | null,
	/**
	default: 'w' for `Fs.writeFile`, 'a' for `Fs.appendFile`
	*/
	flag?: string | null,
	/**
	default = 438 (aka 0666 in Octal)
	*/
	mode?: any
}

/**
Options for `Fs.createReadStream`.
*/
export type FsCreateReadStreamOptions = {
	/**
	If autoClose is false, then the file descriptor won't be closed, even if there's an error.
	It is your responsiblity to close it and make sure there's no file descriptor leak.

	If autoClose is set to true (default behavior), on error or end the file
	descriptor will be closed automatically.
	*/
	autoClose?: boolean | null,
	/**
	can be 'utf8', 'ascii', or 'base64'.
	default: null
	*/
	encoding?: string | null,
	/**
	End of the range of bytes to read
	*/
	end?: number | null,
	/**
	default: null
	*/
	fd?: number | null,
	/**
	default: 'r'
	*/
	flags?: string | null,
	/**
	default: 0666
	*/
	mode?: any,
	/**
	Start of the range of bytes to read
	*/
	start?: number | null
}

/**
Options for `Fs.createWriteStream`.
*/
export type FsCreateWriteStreamOptions = {
	/**
	default: null
	*/
	encoding?: string | null,
	/**
	default: 'w'
	*/
	flags?: string | null,
	/**
	default: 0666
	*/
	mode?: any,
	/**
	position to write data the beginning of the file.
	*/
	start?: number | null
}

/**
Constants for use in `Fs` module.

Note: Not every constant will be available on every operating system.
*/
export type FsConstants = {
	/**
	Flag indicating that the file is visible to the calling process.
	Meant for use with `Fs.access`.
	*/
	F_OK: number,
	/**
	Flag indicating that data will be appended to the end of the file.
	*/
	O_APPEND: number,
	/**
	Flag indicating to create the file if it does not already exist.
	*/
	O_CREAT: number,
	/**
	When set, an attempt will be made to minimize caching effects of file I/O.
	*/
	O_DIRECT: number,
	/**
	Flag indicating that the open should fail if the path is not a directory.
	*/
	O_DIRECTORY: number,
	/**
	Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists.
	*/
	O_EXCL: number,
	/**
	Flag indicating reading accesses to the file system will no longer result in an update to the atime information associated with the file. This flag is available on Linux operating systems only.
	*/
	O_NOATIME: number,
	/**
	Flag indicating that if path identifies a terminal device, opening the path shall not cause that terminal to become the controlling terminal for the process (if the process does not already have one).
	*/
	O_NOCTTY: number,
	/**
	Flag indicating that the open should fail if the path is a symbolic link.
	*/
	O_NOFOLLOW: number,
	/**
	Flag indicating to open the file in nonblocking mode when possible.
	*/
	O_NONBLOCK: number,
	/**
	Flag indicating to open a file for read-only access.
	*/
	O_RDONLY: number,
	/**
	Flag indicating to open a file for read-write access.
	*/
	O_RDWR: number,
	/**
	Flag indicating to open the symbolic link itself rather than the resource it is pointing to.
	*/
	O_SYMLINK: number,
	/**
	Flag indicating that the file is opened for synchronous I/O.
	*/
	O_SYNC: number,
	/**
	Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero.
	*/
	O_TRUNC: number,
	/**
	Flag indicating to open a file for write-only access.
	*/
	O_WRONLY: number,
	/**
	Flag indicating that the file can be read by the calling process.
	Meant for use with `Fs.access`.
	*/
	R_OK: number,
	/**
	File type constant for a block-oriented device file.
	*/
	S_IFBLK: number,
	/**
	File type constant for a character-oriented device file.
	*/
	S_IFCHR: number,
	/**
	File type constant for a directory.
	*/
	S_IFDIR: number,
	/**
	File type constant for a FIFO/pipe.
	*/
	S_IFIFO: number,
	/**
	File type constant for a symbolic link.
	*/
	S_IFLNK: number,
	/**
	Bit mask used to extract the file type code.
	*/
	S_IFMT: number,
	/**
	File type constant for a regular file.
	*/
	S_IFREG: number,
	/**
	File type constant for a socket.
	*/
	S_IFSOCK: number,
	/**
	File mode indicating readable by group.
	*/
	S_IRGRP: number,
	/**
	File mode indicating readable by others.
	*/
	S_IROTH: number,
	/**
	File mode indicating readable by owner.
	*/
	S_IRUSR: number,
	/**
	File mode indicating readable, writable and executable by group.
	*/
	S_IRWXG: number,
	/**
	File mode indicating readable, writable and executable by others.
	*/
	S_IRWXO: number,
	/**
	File mode indicating readable, writable and executable by owner.
	*/
	S_IRWXU: number,
	/**
	File mode indicating writable by group.
	*/
	S_IWGRP: number,
	/**
	File mode indicating writable by others.
	*/
	S_IWOTH: number,
	/**
	File mode indicating writable by owner.
	*/
	S_IWUSR: number,
	/**
	File mode indicating executable by group.
	*/
	S_IXGRP: number,
	/**
	File mode indicating executable by others.
	*/
	S_IXOTH: number,
	/**
	File mode indicating executable by owner.
	*/
	S_IXUSR: number,
	/**
	Flag indicating that the file can be written by the calling process.
	Meant for use with `Fs.access`.
	*/
	W_OK: number,
	/**
	Flag indicating that the file can be executed by the calling process.
	Meant for use with `Fs.access`.
	*/
	X_OK: number
}
