#!/bin/sh
set -e

# Ensure data and audio directories exist and have proper www-data permissions
mkdir -p /var/www/html/data /var/www/html/assets/audio

# Ensure www-data user has full write permissions for SQLite database and uploads
chown -R www-data:www-data /var/www/html/data /var/www/html/assets/audio
chmod -R 775 /var/www/html/data /var/www/html/assets/audio

# Execute CMD (apache2-foreground)
exec "$@"
