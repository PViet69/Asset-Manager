"""Provider-neutral manual storage sync package."""

from enum import StrEnum


class StorageProvider(StrEnum):
    GOOGLE_DRIVE = "google_drive"
    DROPBOX = "dropbox"

    @property
    def display_name(self) -> str:
        _display_names = {
            StorageProvider.GOOGLE_DRIVE: "Google Drive",
            StorageProvider.DROPBOX: "Dropbox",
        }
        return _display_names.get(self, self.value.replace("_", " ").title())


Providers = StorageProvider


__all__ = [
    "Providers",
    "StorageProvider",
]


