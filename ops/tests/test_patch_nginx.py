from __future__ import annotations

import unittest

from ops.patch_nginx import INCLUDE, patch


HTTP_WITH_INCLUDE = """server {
    listen 80;
    include /etc/nginx/snippets/helpinrus-auth-api.conf;
}
"""

TLS_BLOCK = """server {
    listen 443 ssl;
    server_name 201.51.4.212;
    root /var/www/helpinrus;
}
"""

UNRELATED_TLS_BLOCK = """server {
    listen [::]:443 ssl;
    server_name unrelated.example;
    root /srv/unrelated;
    add_header Content-Security-Policy "connect-src 'self' https://cdn.jsdelivr.net";
}
"""


class PatchNginxTestCase(unittest.TestCase):
    def test_include_in_http_block_does_not_suppress_tls_include(self) -> None:
        updated = patch(HTTP_WITH_INCLUDE + TLS_BLOCK)
        blocks = updated.split("server {")
        self.assertIn(INCLUDE.strip(), blocks[1])
        self.assertIn(INCLUDE.strip(), blocks[2])

    def test_patch_is_idempotent_inside_tls_block(self) -> None:
        updated = patch(TLS_BLOCK)
        self.assertEqual(updated.count(INCLUDE.strip()), 1)
        self.assertEqual(patch(updated), updated)

    def test_patch_rejects_configuration_without_tls_server(self) -> None:
        with self.assertRaisesRegex(ValueError, "TLS server block"):
            patch("server {\n    listen 80;\n}\n")

    def test_legacy_external_sources_are_removed(self) -> None:
        updated = patch(
            TLS_BLOCK.replace(
                "root /var/www/helpinrus;",
                "add_header Content-Security-Policy \"connect-src 'self' "
                "https://cdn.jsdelivr.net "
                "https://llnjgyehxsogjmwegnyf.supabase.co "
                "wss://llnjgyehxsogjmwegnyf.supabase.co\";",
            )
        )
        self.assertNotIn("cdn.jsdelivr.net", updated)
        self.assertNotIn("supabase.co", updated)

    def test_patch_skips_unrelated_tls_vhost(self) -> None:
        updated = patch(UNRELATED_TLS_BLOCK + TLS_BLOCK)
        blocks = updated.split("server {")
        self.assertNotIn(INCLUDE.strip(), blocks[1])
        self.assertIn("cdn.jsdelivr.net", blocks[1])
        self.assertIn(INCLUDE.strip(), blocks[2])

    def test_exact_root_wins_over_unrelated_matching_server_name(self) -> None:
        misleading = UNRELATED_TLS_BLOCK.replace(
            "unrelated.example", "201.51.4.212"
        )
        updated = patch(misleading + TLS_BLOCK.replace(
            "201.51.4.212", "helpinrus.example"
        ))
        blocks = updated.split("server {")
        self.assertNotIn(INCLUDE.strip(), blocks[1])
        self.assertIn(INCLUDE.strip(), blocks[2])

    def test_server_name_is_used_when_root_is_not_literal(self) -> None:
        dynamic_root = TLS_BLOCK.replace(
            "root /var/www/helpinrus;", "root $helpinrus_root;"
        )
        self.assertIn(INCLUDE.strip(), patch(dynamic_root))

    def test_ambiguous_helpinrus_tls_blocks_are_rejected(self) -> None:
        duplicate = TLS_BLOCK.replace("201.51.4.212", "helpinrus.example")
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            patch(duplicate + duplicate)


if __name__ == "__main__":
    unittest.main()
