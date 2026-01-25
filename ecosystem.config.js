module.exports = {
    apps: [{
        name: "mlx-inference-server",
        script: "./scripts/start-mlx.sh",
        interpreter: "bash",
        cwd: ".",
        out_file: "./.pm2/logs/mlx-out.log",
        error_file: "./.pm2/logs/mlx-error.log",
        merge_logs: true,
        autorestart: true,
        max_restarts: 5,
        restart_delay: 2000,
        env: {
            "PORT": "8080"
        }
    }]
}
